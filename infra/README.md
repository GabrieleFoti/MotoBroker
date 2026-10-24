# Infrastruttura CMS MotoBroker

Backend del pannello admin: Cognito (login email+password, niente account GitHub) + API
Gateway HTTP API (JWT authorizer) + Lambda `motobroker-cms` (Node.js 22, solo AWS SDK v3 +
`fetch` globale, nessuna dipendenza extra). **Il repo GitHub resta l'unico archivio dati**
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
- **Secret Manager** `motobroker/github-token`: **non ancora creato** — va fatto da
  Gabriele con un fine-grained PAT (solo repo MotoBroker, permesso Contents read/write).
  Non è mai stato messo nel codice né nei log; la Lambda legge solo il nome del secret
  dall'env var `GITHUB_TOKEN_SECRET_ID` e lo recupera a runtime.

Nessuna modifica a Pages, DNS, workflow `.github/workflows/deploy.yml` o a Decap CMS
(rimane attivo finché la card 2/3 non lo sostituisce).

## Rotte

Tutte dietro Cognito JWT. `BRANCH` = `main` in produzione (env `GITHUB_BRANCH`,
configurabile solo per i test E2E su `cms-test`).

### `GET /moto`
Legge l'albero Git di `BRANCH`, raggruppa i file per cartella `moto/<slug>/`, parsa
`info.yaml` (parser YAML minimale su misura per lo schema fisso del progetto, non un parser
generico) e ritorna `{ headSha, moto: [{slug, marca, modello, anno, km?, cilindrata?,
prezzo?, descrizione?, venduta, foto[]}] }`. L'ordine di `foto` è quello dichiarato in
`info.yaml`, con le foto presenti nella cartella ma non elencate accodate in ordine
alfabetico (stessa regola di `src/lib/foto.ts`).

### `POST /blobs`
Body `{content: base64, encoding: "base64"}`, una foto per chiamata. Rifiuta payload oltre
~4MB di base64 e qualunque formato diverso da JPEG/PNG/WEBP (verificato sui magic byte del
file decodificato, non sul nome/Content-Type dichiarato dal client). Ritorna `{sha,
format}`: lo sha è quello del blob Git appena creato, da passare poi a `PUT /moto/:slug`.

### `PUT /moto/:slug`
Body `{headSha, data, photos:[{name, sha?}], previousSlug?}`. Un solo commit su `BRANCH`:

1. Verifica che `headSha` sia ancora la testa del branch, altrimenti **409** (nessuna
   scrittura).
2. Valida `data` con le stesse regole di `src/content.config.ts`.
3. Rigenera lo slug atteso da `marca`+`modello` con lo stesso algoritmo di Decap
   (minuscolo, ascii, accenti rimossi, spazi/simboli → `-`) e lo confronta con `:slug`
   nell'URL: se non combaciano, **400** (lo slug non è scelto liberamente dal client).
4. Per ogni foto: usa lo sha passato (nuova, già caricata con `/blobs`) oppure, se assente,
   recupera lo sha del file già esistente nella cartella (`previousSlug` se è una
   rinomina, altrimenti `slug`) — **400** se non lo trova.
5. Costruisce un unico albero Git (`git/trees` con `base_tree`) che aggiunge/aggiorna
   `info.yaml` e le foto, e rimuove le foto non più presenti (o, in caso di rinomina,
   l'intera vecchia cartella).
6. Crea il commit (`cms: aggiorna <slug> (<email utente dal JWT>)`) e aggiorna il ref con
   `force:false`: se nel frattempo il branch è avanzato, GitHub rifiuta l'update e la
   risposta diventa **409**.

### `DELETE /moto/:slug`
Body `{headSha}`. Stesso schema 409 di sopra; un commit che rimuove tutta la cartella
`moto/<slug>/`.

### `GET /deploy-status`
Ultima run di `.github/workflows/deploy.yml` su `main` (stato pubblico, letto senza
autenticazione verso GitHub perché il repo è pubblico — non richiede allo scope del PAT
l'accesso ad Actions). Serve al pannello per dire "online fra poco" dopo un salvataggio.

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

## Stato attuale: bloccato sul secret GitHub

Il secret `motobroker/github-token` **non esiste ancora** in Secrets Manager (verificato
con `describe-secret`: `ResourceNotFoundException`). Tutto il resto dell'infrastruttura è
deployato e verificato (vedi sotto); le rotte che parlano con GitHub rispondono **500**
finché il secret non viene creato, perché la Lambda non trova nulla da leggere.

Gabriele deve crearlo con:

```bash
aws secretsmanager create-secret --name motobroker/github-token \
  --secret-string <fine-grained PAT, permesso Contents read/write sul solo repo MotoBroker> \
  --profile Zentrya --region us-east-1
```

Dopo la creazione del secret si potranno eseguire i test end-to-end obbligatori (branch
`cms-test`, utente Cognito di prova, 401/GET/PUT con 2 foto/409/DELETE) e aprire la PR.

## Verifiche già eseguite (senza il secret)

- `deploy.sh` rieseguito due volte: nessuna modifica inattesa alla seconda run (idempotente).
- `GET /moto` senza token → **401**.
- Utente Cognito di prova creato con `admin-set-user-password --permanent`, login con
  `initiate-auth --auth-flow USER_PASSWORD_AUTH` → token ottenuto.
- `GET /moto` con token valido → **500** con nei log CloudWatch
  `ResourceNotFoundException` su `GetSecretValueCommand` (comportamento atteso: authorizer
  JWT passa, la rotta fallisce solo per il secret mancante).
- `POST /blobs` con token valido, body `{}` → **400** `encoding deve essere "base64"`
  (validazione lato server attiva, non serve GitHub per questo controllo).
- `GET /deploy-status` senza token → **401** (authorizer applicato anche a questa rotta,
  come richiesto).
- Utente Cognito di prova cancellato a fine verifica (`list-users` conferma 0 utenti nel
  pool).
- Unit test locali (Node, fuori da `npm test`) su `slugify`/`serializeInfoYaml`/
  `parseInfoYaml`/`detectImageFormat`: il serializzatore YAML riproduce **byte per byte**
  un `info.yaml` reale del repo (`moto/bmw-r-1150-twin-spark/info.yaml`), round-trip
  parse→serialize verificato.

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
