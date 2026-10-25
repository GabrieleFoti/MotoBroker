# Pannello admin (Cognito)

Il pannello vive su `/admin/` del sito pubblicato. Non serve più un account GitHub:
si accede con email + password (Amazon Cognito). Salvando una moto, il pannello
chiama l'API (`infra/`, vedi `infra/README.md`), che fa commit diretto di
`moto/<slug>/info.yaml` + foto nel repo con l'API Git di GitHub; la GitHub Action
(`.github/workflows/deploy.yml`) rebuilda e pubblica il sito su Pages in 1-2 minuti.

## Cosa è stato rimosso

- Decap CMS (`src/pages/admin.astro` caricava `decap-cms` da unpkg) e la sua
  configurazione `public/admin/config.yml`.
- Il worker Cloudflare `motobroker-decap-proxy` (proxy OAuth di Decap) e la
  relativa GitHub OAuth App non servono più al pannello, ma **non vengono
  spenti da questa card**: rimangono attivi fino alla card di passaggio in
  produzione (dismissione esplicita, non automatica).
- L'accesso scrittura al repo GitHub per chi usava solo il pannello non è più
  necessario (resta comunque valido per chi lavora sul codice).

## Come funziona ora

Il pannello (`src/admin/`, caricato da `src/pages/admin.astro`) è un'app JS
vanilla (nessun framework, nessuna CDN esterna) in un'unica isola client-side:

- `cognito.js` — login, cambio password al primo accesso (`NEW_PASSWORD_REQUIRED`,
  completato **senza** rimandare attributi già impostati, altrimenti Cognito
  risponde "Cannot modify an already provided email"), password dimenticata.
- `api.js` — client delle rotte `GET /moto`, `POST /blobs`, `PUT/DELETE /moto/:slug`,
  `GET /deploy-status`, con token Cognito nell'header `Authorization`.
- `imageUtils.js` — ridimensionamento delle foto **nel browser** prima
  dell'upload (lato lungo max ~2400px, JPEG qualità ~0.85); Astro ottimizza
  ulteriormente in build con `getImage`.
- `app.js` — l'applicazione: login, elenco moto (ricerca, badge «Venduta»,
  toggle rapido), form (tutti i campi di `src/content.config.ts`, upload foto
  con avanzamento, riordino a trascinamento — la prima è la copertina —,
  rimozione), eliminazione con conferma.

## Come creare un utente

Nessun self-signup. Un utente si crea con la AWS CLI (profilo `Zentrya`,
regione `us-east-1`) sul pool Cognito `motobroker-admin`
(`infra/outputs.json` → `userPoolId`):

```bash
aws cognito-idp admin-create-user \
  --profile Zentrya --region us-east-1 \
  --user-pool-id <userPoolId> \
  --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Cognito genera una password temporanea e la invia per email (nessuna
configurazione SES/SMTP necessaria). Al primo accesso il pannello mostra il
flusso "primo accesso": l'utente imposta una password definitiva (almeno 10
caratteri, maiuscole, minuscole e numeri).

Per cancellare un utente di test:

```bash
aws cognito-idp admin-delete-user --profile Zentrya --region us-east-1 \
  --user-pool-id <userPoolId> --username <email>
```

## Slug e link pubblicati

Lo slug di una moto esistente (`moto/<slug>/`, quindi il link
`/moto/<slug>/`) **non cambia** modificando marca o modello: il pannello
continua a salvare sullo stesso slug. Se la modifica di marca/modello
cambierebbe lo slug, il pannello chiede conferma esplicita prima di
procedere (il vecchio link smette di funzionare dopo la conferma).

## Salvataggi concorrenti

Ogni salvataggio passa l'`headSha` letto all'ultimo caricamento. Se nel
frattempo qualcun altro ha salvato, l'API risponde **409**: il pannello
mostra "Qualcun altro ha salvato nel frattempo", ricarica l'elenco più
recente **senza perdere la bozza aperta** e permette di salvare di nuovo.

## Dopo il salvataggio

Il pannello mostra "Salvato. Online fra 1–2 minuti" con un link alla scheda
pubblica (`/moto/<slug>/`) e, quando disponibile, lo stato dell'ultima run
del workflow di deploy (`GET /deploy-status`).

## Prova in locale

```bash
npm run dev
```

Apri `http://localhost:4321/admin/` — serve le stesse API di produzione
(`infra/outputs.json`), quindi serve un utente Cognito reale per accedere.
Per test E2E contro un branch diverso da `main` (es. `cms-test`), vedi
`infra/README.md` (variabile Lambda `GITHUB_BRANCH`) e usa le variabili
`VITE_CMS_GITHUB_BRANCH` (anteprime foto) impostandole in un file `.env` o
passandole al comando `dev`/`build`.
