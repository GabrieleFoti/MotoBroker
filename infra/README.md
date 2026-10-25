# Infrastruttura CMS MotoBroker

Backend del pannello admin: Cognito (login email+password, niente account GitHub) + API
Gateway HTTP API (JWT authorizer) + Lambda `motobroker-cms` (Node.js 22, solo AWS SDK v3 +
`fetch` globale; unica dipendenza `js-yaml`, lo stesso parser YAML di Astro). **Il repo GitHub resta l'unico archivio dati**
(niente database, niente storage immagini dedicato): la Lambda committa su `main` al posto
dell'utente usando l'API REST/Git Data di GitHub, con lo stesso token che userebbe un
account con accesso in scrittura al repo — ma senza che l'utente del pannello debba averne
uno.

## Scelta tecnica

Stesso pattern di `bertoniassociati/infra` (script AWS CLI idempotente invece di
CloudFormation/SAM, Lambda Node 22 con solo SDK AWS): qui però non c'è bucket dati, il
"database" è il repo Git stesso, letto/scritto con le API a basso livello di Git
(`git/blobs`, `git/trees`, `git/commits`, `git/refs`) per poter fare **un solo commit
atomico** per ogni salvataggio (info.yaml + foto nuove + foto rimosse insieme).

## Risorse create (account Zentrya, us-east-1)

- **Cognito User Pool** `motobroker-admin` (`us-east-1_VsUpLgY2g`): login con email,
  self-signup disabilitato (`AllowAdminCreateUserOnly=true`), recupero password via email,
  policy password minima 10 caratteri maiuscole/minuscole/numeri. **Nessun utente reale
  creato** (lo farà la card successiva/Gabriele).
- **App client** `motobroker-admin-web` (`328r334ipir5d3fgp1mlh4vd3l`): pubblico, senza
  secret, flussi `ALLOW_USER_PASSWORD_AUTH` + `ALLOW_USER_SRP_AUTH` +
  `ALLOW_REFRESH_TOKEN_AUTH`.
- **Lambda** `motobroker-cms` (`infra/lambda/index.mjs`), ruolo IAM dedicato
  `motobroker-cms-lambda-role` con permesso minimo: `secretsmanager:GetSecretValue` solo
  sull'ARN del secret `motobroker/github-token-*`, più log CloudWatch. **Nessun permesso
  S3/CloudFront**: la Lambda parla solo con l'API di GitHub.
- **API Gateway HTTP API** `motobroker-cms-api` (`4i4hverz39`), authorizer JWT Cognito
  (issuer/audience del pool/client sopra) su **tutte** le rotte (anche `/deploy-status`),
  CORS limitato a `https://motobroker.it`, `https://www.motobroker.it`,
  `http://localhost:4321`.
- **Secrets Manager** `motobroker/github-token`: fine-grained PAT creato da Gabriele (solo
  repo MotoBroker, permesso Contents read/write; se ha anche Actions: read, `/deploy-status`
  lo usa). Mai nel codice né nei log; la Lambda legge solo il nome del secret dall'env var
  `GITHUB_TOKEN_SECRET_ID`. Se GitHub risponde 401 (token ruotato) la Lambda svuota la cache
  e lo rilegge una volta, quindi la rotazione non richiede redeploy.

Nessuna modifica a Pages, DNS, workflow `.github/workflows/deploy.yml` o a Decap CMS
(rimane attivo finché la card 2/3 non lo sostituisce).

## Rotte

Tutte dietro Cognito JWT. `BRANCH` = `main` in produzione (env `GITHUB_BRANCH`,
configurabile solo per i test E2E su `cms-test`).

### `GET /moto`
Legge l'albero Git di `BRANCH`, raggruppa i file per cartella `moto/<slug>/`, legge
`info.yaml` con **js-yaml** (lo stesso parser che usa Astro in build, quindi anche i block
scalar `|` e `>` delle descrizioni scritte da Decap) e ritorna `{ headSha, moto: [{slug,
marca, modello, anno, km?, cilindrata?, prezzo?, descrizione?, venduta, foto[]}] }`. L'ordine
di `foto` è quello dichiarato in `info.yaml`, con le foto presenti nella cartella ma non
elencate accodate in ordine alfabetico (stessa regola di `src/lib/foto.ts`). Se GitHub
restituisce un albero troncato, la richiesta fallisce invece di lavorare su un elenco
incompleto.

### `POST /blobs`
Body `{content: base64, encoding: "base64"}`, una foto per chiamata. Rifiuta payload oltre
~4MB di base64 e qualunque formato diverso da JPEG/PNG/WEBP (verificato sui magic byte del
file decodificato, non sul nome/Content-Type dichiarato dal client). Ritorna `{sha, format,
receipt}`: `receipt` è un HMAC dello sha firmato lato server; va ripassato a `PUT` insieme
allo sha, così come foto può finire solo un'immagine passata da `/blobs` e non un blob
qualunque del repo.

### `PUT /moto/:slug`
Body `{headSha, data, photos:[{name, sha?, receipt?}], create?, previousSlug?}`. Un solo
commit su `BRANCH`. Tre casi espliciti, così una moto non può mai sovrascriverne un'altra:

| Caso | Slug | Errori |
|---|---|---|
| `create: true` (nuova moto) | deve essere `slugify(marca-modello)` (come Decap) | **409** `SLUG_EXISTS` se `moto/<slug>/` esiste già |
| `previousSlug` diverso da `:slug` (rinomina esplicita) | deve essere `slugify(marca-modello)` | **404** se l'origine non esiste, **409** `SLUG_EXISTS` se la destinazione esiste |
| nessuno dei due (aggiornamento) | resta quello della cartella, anche se marca/modello cambiano | **404** se la cartella non esiste |

Lo slug viene imposto solo alla creazione o alla rinomina, come fa Decap: le moto già
pubblicate con una cartella diversa da `slugify(marca-modello)` (es. `ducati-monster`,
`husqvarna-fe`, `kawasaki-ninja`) si modificano senza cambiare URL.

Poi:
1. Verifica che `headSha` sia ancora la testa del branch, altrimenti **409** `HEAD_MOVED`.
2. Valida `data` con le stesse regole di `src/content.config.ts`.
3. Per ogni foto: se ha `sha` e non è già un file della cartella, serve la `receipt` di
   `/blobs` (**400** altrimenti); se non ha `sha`, si prende quello del file esistente
   (**400** se non c'è).
4. Scrive `info.yaml` nello stile dei file di Decap: valori su una riga quando js-yaml li
   rilegge identici, altrimenti tra virgolette doppie; descrizioni multilinea come block
   scalar `|`. Prima di scrivere rilegge il file prodotto e si ferma se un campo non
   torna identico.
5. Un unico albero Git (`git/trees` con `base_tree`) con `info.yaml`, foto nuove e foto
   rimosse (in rinomina, tutta la vecchia cartella); commit `cms: crea|aggiorna|rinomina
   … <slug> (<email>)`; update del ref con `force:false` → **409** se il branch è avanzato.

### `DELETE /moto/:slug`
Body `{headSha}`. Stesso schema 409 di sopra; un commit che rimuove tutta la cartella
`moto/<slug>/`.

### `GET /deploy-status`
Ultima run di `.github/workflows/deploy.yml` su `main`. Prova prima con il token (quota
5.000/h; serve `Actions: read` sul PAT), poi in lettura anonima (repo pubblico, 60/h per IP
condivisa). Se entrambe falliscono risponde **200** con `{status: "unknown"}` invece di un
errore, così il polling del pannello non va in errore.

## Niente path traversal / scritture fuori da `moto/<slug>/`

I nomi foto sono validati con una regex che esclude `/`, `..` e qualunque carattere fuori
da `[a-z0-9._-]` (più estensione jpg/jpeg/png/webp); lo slug con `^[a-z0-9-]+$`. Tutti i
path scritti dalla Lambda sono sempre `moto/<slug (validato)>/<nome foto (validato)>` o
`moto/<slug>/info.yaml`: il client non passa mai un path libero.

## Costi stimati (CMS interno, poche decine di salvataggi al mese)

- **Cognito**: gratuito fino a 10.000 MAU (free tier permanente).
- **Lambda**: 1M richieste/mese + 400.000 GB-s gratuiti; con poche centinaia di invocazioni
  al mese, **~0€**.
- **API Gateway HTTP API**: $1.00/milione di richieste dopo il primo anno di free tier;
  con un uso da CMS interno, **centesimi di euro/mese**.
- **Secrets Manager**: $0.40/mese per secret + $0.05/10.000 chiamate — con cache in memoria
  del token per il ciclo di vita del container Lambda, poche chiamate al mese,
  **~0,40€/mese** (unico costo non trascurabile, fisso).
- **GitHub API**: nessun costo, nei limiti di rate del PAT (5.000 richieste/ora).

**Stima complessiva: ~0,40–0,50€/mese.**

## Verifiche

Test automatici in `npm test` (`infra/lambda/lib.test.ts`, oltre a quelli del sito):
- ogni `moto/*/info.yaml` del repo viene letto esattamente come lo legge js-yaml/Astro, e
  riscritto senza modifiche si rilegge identico (compresa la descrizione multilinea di
  `ducati-monster` e quelle `>` di `kawasaki-zx-9r` e `cf-moto-650-mt`);
- descrizioni dal pannello con a capo, `#`, `" #"`, due punti, virgolette, tab, CRLF,
  spazi iniziali/finali, valori che sembrano numeri o booleani: tornano identiche e il file
  resta YAML valido;
- slug come Decap, validazione dei campi, magic byte, ricevute dei blob.

Test end-to-end contro GitHub (branch di prova `cms-test`, utente Cognito di prova poi
cancellato; nessun commit su `main`): vedi la descrizione della PR per l'ultima esecuzione.

## Deploy

```bash
cd infra
./deploy.sh
```

Richiede `aws`, `jq`, `zip` nel PATH e il profilo AWS `Zentrya`. Rigenera
`infra/outputs.json` con `apiUrl`, `userPoolId`, `clientId`, `region` ad ogni run. Per i
test E2E sul branch `cms-test`, impostare temporaneamente `GITHUB_BRANCH=cms-test` come
variabile d'ambiente della Lambda (es. `aws lambda update-function-configuration
--environment Variables={...,GITHUB_BRANCH=cms-test}`), eseguire i test, poi rimetterla su
`main` (`./deploy.sh` la resetta automaticamente, essendo hardcoded a `main` di default).
