# Design: Sito vetrina Motobroker.it

**Data:** 2026-07-13
**Stato:** Approvato

## Obiettivo

Sito vetrina per Motobroker.it, intermediario per la vendita di moto usate tra privati. Presenta i servizi del broker e una galleria delle moto attualmente in vendita, aggiornabile aggiungendo foto in una cartella.

## Architettura

- **Generatore statico:** Astro
- **Hosting:** GitHub Pages, deploy automatico via GitHub Actions (push su `main` → build → pubblicazione)
- **Dominio:** motobroker.it collegabile in seguito tramite file `CNAME` e DNS
- Nessun backend, nessun database: tutto il contenuto è generato al build

## Contenuto moto

Struttura della cartella `moto/` alla radice del progetto:

```
moto/
  ducati-panigale-v4/
    info.yaml
    01.jpg
    02.jpg
    ...
```

### info.yaml

```yaml
marca: Ducati
modello: Panigale V4
anno: 2022
km: 8500
cilindrata: 1103
prezzo: 21500        # opzionale; se assente si mostra "Prezzo su richiesta"
descrizione: >
  Testo libero con condizioni, accessori, tagliandi.
venduta: false        # true → badge "VENDUTA" sulla scheda
```

### Regole

- La prima foto in ordine alfabetico è la copertina della scheda.
- Il nome della cartella è lo slug dell'URL (`/moto/ducati-panigale-v4`).
- Le moto con `venduta: true` restano visibili con badge "VENDUTA" (prova sociale), ordinate dopo quelle disponibili.
- Le immagini sono ottimizzate al build da Astro: conversione webp, dimensioni multiple responsive, lazy loading.
- Validazione al build: `info.yaml` mancante o campi obbligatori assenti (marca, modello, anno) fanno fallire il build con messaggio chiaro.

## Pagine

### Home `/` (single page a scorrimento)

1. **Hero** — stile locandina: sfondo nero, titolo "VENDI LA TUA MOTO!" in rosso, sottotitolo "In modo sicuro, veloce e senza stress", CTA "Chiama" e "WhatsApp".
2. **Servizi** — i 5 punti della locandina con icone: valutazione professionale, servizio foto e annunci, gestione trattativa, vendita sicura e garantita, più veloci meno pensieri.
3. **Come funziona** — 4 step per chi vende: contatto, valutazione, annuncio e foto, vendita gestita.
4. **Anteprima galleria** — ultime moto disponibili + link alla galleria completa.
5. **Chi siamo + recensioni** — testo segnaposto da sostituire con contenuto reale.
6. **Contatti** — telefono 328-611-9960 cliccabile (`tel:`), bottone WhatsApp (`wa.me`), orari.

### Galleria `/moto`

Griglia di schede: foto copertina, marca/modello, anno, km, prezzo (o "Prezzo su richiesta"), badge "VENDUTA" quando applicabile.

### Dettaglio `/moto/<slug>`

Foto grandi in carosello/griglia, tutti i dati di `info.yaml`, descrizione, CTA "Chiedi info su WhatsApp" con messaggio precompilato contenente marca e modello.

## Stile

Derivato dalla locandina:

- Sfondo nero profondo, rosso acceso per titoli e accenti, arancione per il marchio "BROKER.IT"
- Font condensato bold per i titoli, testo leggibile per il corpo
- Texture/atmosfera scura in stile locandina
- Mobile-first: il pubblico naviga principalmente da telefono
- SEO base: title/description per pagina, Open Graph con foto copertina per condivisione WhatsApp

## Aggiornamento galleria

1. Creare cartella in `moto/` con foto e `info.yaml`
2. `git push`
3. GitHub Actions ricostruisce e pubblica in ~2 minuti

## Fuori scope

- Pannello admin / CMS
- Form di contatto con backend (contatto solo via telefono/WhatsApp)
- Ricerca/filtri nella galleria (aggiungibili in futuro se le moto diventano tante)
