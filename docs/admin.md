# Pannello admin (Decap CMS)

Il pannello vive su `/admin/` del sito pubblicato. Salvando una moto, Decap
committa `moto/<slug>/info.yaml` + foto nel repo; la GitHub Action
(`.github/workflows/deploy.yml`) rebuilda e pubblica il sito su Pages in 1-2 minuti.

## Attivazione (una tantum)

1. **Push del repo su GitHub** e in *Settings → Pages* imposta Source = "GitHub Actions".
2. **Aggiorna `public/admin/config.yml`**: sostituisci `TUO-UTENTE/MotoBroker`
   con owner/repo reali.
3. **OAuth proxy** (serve perché GitHub Pages non può custodire il client secret):
   - Crea una GitHub OAuth App (*Settings → Developer settings → OAuth Apps*):
     - Homepage URL: l'URL del sito Pages
     - Authorization callback URL: `https://<proxy>/callback`
   - Deploya un proxy OAuth gratuito, ad es. [sterlingwes/decap-proxy](https://github.com/sterlingwes/decap-proxy)
     su Cloudflare Workers (piano free), con `client_id`/`client_secret` dell'OAuth App.
   - In `config.yml` decommenta `base_url` puntando al worker.
4. Apri `https://<sito>/admin/`, login con GitHub: solo chi ha accesso in
   scrittura al repo può salvare.

## Prova in locale (senza OAuth)

```bash
npx decap-server   # terminale 1
npm run dev        # terminale 2
```

Poi apri `http://localhost:4321/admin/` — con `local_backend: true` scrive
direttamente sui file locali, senza login.

## Note

- Le foto vanno nominate `01.jpg`, `02.jpg`, ... : l'ordine alfabetico decide
  l'ordine in galleria e la copertina.
- Il campo `copertina` nel CMS serve solo a caricare file nella cartella della
  moto: il sito legge tutte le immagini della cartella, non quel campo.
- Prima del go-live valutare `local_backend: false` (è ignorato in produzione,
  ma tenerlo esplicito evita confusione).
