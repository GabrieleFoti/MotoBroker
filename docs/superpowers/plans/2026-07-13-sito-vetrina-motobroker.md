# Sito vetrina Motobroker.it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sito statico Astro per Motobroker.it con home vetrina in stile locandina e galleria moto generata dalle cartelle in `moto/`, pubblicato su GitHub Pages.

**Architecture:** Astro 5 con content collection basata su glob loader che legge `moto/*/info.yaml`; le foto di ogni moto vivono nella stessa cartella e sono ottimizzate da `astro:assets`. Home single-page + pagina galleria `/moto` + pagine dettaglio `/moto/<slug>`. Deploy automatico via GitHub Actions su GitHub Pages.

**Tech Stack:** Astro 5, TypeScript, Vitest (helper puri), @fontsource (Anton + Inter), GitHub Actions + GitHub Pages.

## Global Constraints

- Lingua sito: italiano. Telefono mostrato: `328-611-9960`, link `tel:+393286119960`, WhatsApp `https://wa.me/393286119960`.
- Palette da locandina: nero `#0d0a0a`, rosso `#d41217`, arancione `#f28c1e`, bianco `#f5f2f0`, grigio testo `#b8b2ae`.
- Font: Anton (titoli, condensato bold, uppercase), Inter (corpo).
- Mobile-first. Nessun framework JS client; JS client solo dove serve (carosello dettaglio: no, uso griglia foto — zero JS).
- Campi obbligatori `info.yaml`: `marca`, `modello`, `anno`. Opzionali: `km`, `cilindrata`, `prezzo`, `descrizione`, `venduta` (default `false`). Prezzo assente ⇒ "Prezzo su richiesta".
- Ordinamento galleria: disponibili prima delle vendute; a parità, ordine alfabetico per `marca modello`.
- Tutti i link interni passano da `url()` helper (gestione `base` di GitHub Pages).
- Commit frequenti, conventional commits, nessuna attribution.

---

### Task 1: Scaffold Astro + Vitest

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `src/pages/index.astro`, `vitest.config.ts`

**Interfaces:**
- Produces: progetto Astro compilabile con `npm run build`, test runner `npm test`.

- [ ] **Step 1: Crea i file di progetto**

`package.json`:
```json
{
  "name": "motobroker",
  "type": "module",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.astro/
```

`astro.config.mjs` (site/base definitivi in Task 8):
```js
import { defineConfig } from 'astro/config';

export default defineConfig({});
```

`tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

`vitest.config.ts`:
```ts
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: { include: ['src/**/*.test.ts'] },
});
```

`src/pages/index.astro`:
```astro
---
---
<html lang="it"><body><h1>Motobroker.it</h1></body></html>
```

- [ ] **Step 2: Installa dipendenze**

Run: `npm install astro @fontsource/anton @fontsource/inter && npm install -D vitest sharp`
Expected: install senza errori.

- [ ] **Step 3: Verifica build**

Run: `npm run build`
Expected: `Complete!` e cartella `dist/` con `index.html`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json .gitignore src vitest.config.ts
git commit -m "feat: scaffold progetto Astro con Vitest"
```

---

### Task 2: Helper puri (TDD)

**Files:**
- Create: `src/lib/formatta.ts`, `src/lib/formatta.test.ts`, `src/lib/contatti.ts`, `src/lib/url.ts`

**Interfaces:**
- Produces:
  - `formattaPrezzo(prezzo?: number): string` — `21500` → `"21.500 €"`, `undefined` → `"Prezzo su richiesta"`
  - `formattaKm(km?: number): string` — `8500` → `"8.500 km"`, `undefined` → `""`
  - `linkWhatsApp(messaggio?: string): string` — URL `wa.me` con testo urlencoded
  - `TELEFONO_DISPLAY`, `TELEFONO_TEL` (costanti)
  - `url(path: string): string` — prefissa `import.meta.env.BASE_URL`

- [ ] **Step 1: Scrivi i test (falliranno)**

`src/lib/formatta.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formattaKm, formattaPrezzo } from './formatta';
import { linkWhatsApp } from './contatti';

describe('formattaPrezzo', () => {
  it('formatta in euro senza decimali', () => {
    expect(formattaPrezzo(21500)).toBe('21.500 €');
  });
  it('prezzo assente diventa su richiesta', () => {
    expect(formattaPrezzo(undefined)).toBe('Prezzo su richiesta');
  });
});

describe('formattaKm', () => {
  it('formatta con separatore migliaia', () => {
    expect(formattaKm(8500)).toBe('8.500 km');
  });
  it('km assenti danno stringa vuota', () => {
    expect(formattaKm(undefined)).toBe('');
  });
});

describe('linkWhatsApp', () => {
  it('genera link wa.me con messaggio urlencoded', () => {
    expect(linkWhatsApp('Info su Ducati Panigale V4')).toBe(
      'https://wa.me/393286119960?text=Info%20su%20Ducati%20Panigale%20V4'
    );
  });
  it('senza messaggio niente query string', () => {
    expect(linkWhatsApp()).toBe('https://wa.me/393286119960');
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npm test`
Expected: FAIL (moduli inesistenti).

- [ ] **Step 3: Implementa**

`src/lib/formatta.ts`:
```ts
const nf = new Intl.NumberFormat('it-IT');

export function formattaPrezzo(prezzo?: number): string {
  if (prezzo === undefined) return 'Prezzo su richiesta';
  return `${nf.format(prezzo)} €`;
}

export function formattaKm(km?: number): string {
  if (km === undefined) return '';
  return `${nf.format(km)} km`;
}
```

`src/lib/contatti.ts`:
```ts
export const TELEFONO_DISPLAY = '328-611-9960';
export const TELEFONO_TEL = 'tel:+393286119960';
const WHATSAPP_BASE = 'https://wa.me/393286119960';

export function linkWhatsApp(messaggio?: string): string {
  if (!messaggio) return WHATSAPP_BASE;
  return `${WHATSAPP_BASE}?text=${encodeURIComponent(messaggio)}`;
}
```

`src/lib/url.ts`:
```ts
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
```

- [ ] **Step 4: Verifica che passino**

Run: `npm test`
Expected: 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib
git commit -m "feat: helper formattazione, contatti e url"
```

---

### Task 3: Content collection moto + dati di esempio

**Files:**
- Create: `src/content.config.ts`, `src/lib/moto.ts`, `src/lib/moto.test.ts`, `moto/ducati-panigale-v4/info.yaml`, `moto/bmw-r1250gs/info.yaml`, foto placeholder in entrambe le cartelle
- Create: `scripts/placeholder.mjs` (genera jpg di test con sharp)

**Interfaces:**
- Consumes: nulla.
- Produces:
  - Collection `moto` (`getCollection('moto')`), schema zod con campi da Global Constraints.
  - `slugMoto(entry: { id: string }): string` — `"ducati-panigale-v4/info"` → `"ducati-panigale-v4"`
  - `ordinaMoto<T extends { data: { venduta: boolean; marca: string; modello: string } }>(moto: T[]): T[]` — nuova array: disponibili prima, poi alfabetico `marca modello`
  - `fotoMoto(slug: string): ImageMetadata[]` — foto della cartella, ordine alfabetico (in `src/lib/foto.ts`, creato qui)

- [ ] **Step 1: Test per slugMoto e ordinaMoto (falliranno)**

`src/lib/moto.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ordinaMoto, slugMoto } from './moto';

describe('slugMoto', () => {
  it('estrae il nome cartella dall\'id della collection', () => {
    expect(slugMoto({ id: 'ducati-panigale-v4/info' })).toBe('ducati-panigale-v4');
  });
});

describe('ordinaMoto', () => {
  const m = (marca: string, modello: string, venduta: boolean) => ({
    data: { marca, modello, venduta },
  });
  it('mette le disponibili prima delle vendute, poi alfabetico', () => {
    const input = [m('Yamaha', 'R1', false), m('Aprilia', 'RS660', true), m('Bmw', 'R1250GS', false)];
    const out = ordinaMoto(input);
    expect(out.map((x) => x.data.marca)).toEqual(['Bmw', 'Yamaha', 'Aprilia']);
  });
  it('non muta l\'array originale', () => {
    const input = [m('Yamaha', 'R1', true), m('Bmw', 'R1250GS', false)];
    const copia = [...input];
    ordinaMoto(input);
    expect(input).toEqual(copia);
  });
});
```

- [ ] **Step 2: Verifica FAIL**

Run: `npm test`
Expected: FAIL su `./moto` inesistente.

- [ ] **Step 3: Implementa moto.ts**

`src/lib/moto.ts`:
```ts
type MotoBase = { data: { venduta: boolean; marca: string; modello: string } };

export function slugMoto(entry: { id: string }): string {
  return entry.id.split('/')[0];
}

export function ordinaMoto<T extends MotoBase>(moto: T[]): T[] {
  return [...moto].sort((a, b) => {
    if (a.data.venduta !== b.data.venduta) return a.data.venduta ? 1 : -1;
    const na = `${a.data.marca} ${a.data.modello}`;
    const nb = `${b.data.marca} ${b.data.modello}`;
    return na.localeCompare(nb, 'it');
  });
}
```

- [ ] **Step 4: Verifica PASS**

Run: `npm test`
Expected: tutti PASS.

- [ ] **Step 5: Content collection e loader foto**

`src/content.config.ts`:
```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const moto = defineCollection({
  loader: glob({ pattern: '*/info.yaml', base: './moto' }),
  schema: z.object({
    marca: z.string().min(1),
    modello: z.string().min(1),
    anno: z.number().int(),
    km: z.number().int().nonnegative().optional(),
    cilindrata: z.number().int().positive().optional(),
    prezzo: z.number().positive().optional(),
    descrizione: z.string().optional(),
    venduta: z.boolean().default(false),
  }),
});

export const collections = { moto };
```

`src/lib/foto.ts`:
```ts
const tutte = import.meta.glob<{ default: ImageMetadata }>(
  '/moto/**/*.{jpg,jpeg,png,webp}',
  { eager: true }
);

export function fotoMoto(slug: string): ImageMetadata[] {
  return Object.keys(tutte)
    .filter((path) => path.startsWith(`/moto/${slug}/`))
    .sort()
    .map((path) => tutte[path].default);
}
```

- [ ] **Step 6: Dati di esempio**

`scripts/placeholder.mjs`:
```js
import sharp from 'sharp';

const [, , out, colore = '#333333'] = process.argv;
await sharp({
  create: { width: 1600, height: 1067, channels: 3, background: colore },
})
  .jpeg({ quality: 80 })
  .toFile(out);
console.log(`creato ${out}`);
```

Run:
```bash
mkdir -p moto/ducati-panigale-v4 moto/bmw-r1250gs
node scripts/placeholder.mjs moto/ducati-panigale-v4/01.jpg '#8a1014'
node scripts/placeholder.mjs moto/ducati-panigale-v4/02.jpg '#5a0c0f'
node scripts/placeholder.mjs moto/bmw-r1250gs/01.jpg '#2a3a4a'
```

`moto/ducati-panigale-v4/info.yaml`:
```yaml
marca: Ducati
modello: Panigale V4
anno: 2022
km: 8500
cilindrata: 1103
prezzo: 21500
descrizione: >
  Moto di esempio. Sostituire con dati reali.
venduta: false
```

`moto/bmw-r1250gs/info.yaml`:
```yaml
marca: BMW
modello: R 1250 GS
anno: 2020
km: 32000
cilindrata: 1254
prezzo: 14900
descrizione: >
  Moto di esempio venduta. Sostituire con dati reali.
venduta: true
```

- [ ] **Step 7: Verifica che la collection validi**

Run: `npm run build`
Expected: build OK. Poi prova negativa: togli temporaneamente `marca:` da un info.yaml, rilancia `npm run build`, Expected: FAIL con errore zod su `marca`. Ripristina il campo.

- [ ] **Step 8: Commit**

```bash
git add src/content.config.ts src/lib moto scripts
git commit -m "feat: content collection moto con dati di esempio"
```

---

### Task 4: Design system e Layout

**Files:**
- Create: `src/styles/global.css`, `src/layouts/Layout.astro`, `src/components/Header.astro`, `src/components/Footer.astro`
- Modify: `src/pages/index.astro` (usa Layout)

**Interfaces:**
- Produces: `Layout.astro` con props `{ title: string; description: string; ogImage?: string }`; classi CSS globali: `.contenitore` (max-width 1100px), `.bottone` (rosso), `.bottone--whatsapp` (verde), `.titolo-sezione` (Anton uppercase rosso).

- [ ] **Step 1: CSS globale**

`src/styles/global.css`:
```css
@import '@fontsource/anton';
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/700.css';

:root {
  --nero: #0d0a0a;
  --nero-carta: #171212;
  --rosso: #d41217;
  --rosso-scuro: #8a1014;
  --arancione: #f28c1e;
  --bianco: #f5f2f0;
  --grigio: #b8b2ae;
  --font-titoli: 'Anton', sans-serif;
  --font-corpo: 'Inter', sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--nero);
  color: var(--bianco);
  font-family: var(--font-corpo);
  line-height: 1.6;
}

img { max-width: 100%; display: block; }
a { color: inherit; }

.contenitore { max-width: 1100px; margin: 0 auto; padding: 0 1.25rem; }

.titolo-sezione {
  font-family: var(--font-titoli);
  text-transform: uppercase;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  color: var(--rosso);
  letter-spacing: 0.02em;
}

.bottone {
  display: inline-block;
  background: var(--rosso);
  color: var(--bianco);
  font-family: var(--font-titoli);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.8rem 1.6rem;
  border-radius: 6px;
  text-decoration: none;
  transition: background 0.2s;
}
.bottone:hover { background: var(--rosso-scuro); }
.bottone--whatsapp { background: #1fa855; }
.bottone--whatsapp:hover { background: #16813f; }
```

- [ ] **Step 2: Header, Footer, Layout**

`src/components/Header.astro`:
```astro
---
import { url } from '../lib/url';
---
<header class="header">
  <div class="contenitore header__riga">
    <a href={url('/')} class="header__logo">MOTO<span>BROKER.IT</span></a>
    <nav class="header__nav">
      <a href={url('/#servizi')}>Servizi</a>
      <a href={url('/moto/')}>Moto in vendita</a>
      <a href={url('/#contatti')}>Contatti</a>
    </nav>
  </div>
</header>
<style>
  .header { background: var(--nero); border-bottom: 2px solid var(--rosso); position: sticky; top: 0; z-index: 10; }
  .header__riga { display: flex; align-items: center; justify-content: space-between; padding-top: 0.75rem; padding-bottom: 0.75rem; gap: 1rem; flex-wrap: wrap; }
  .header__logo { font-family: var(--font-titoli); font-size: 1.5rem; color: var(--bianco); text-decoration: none; }
  .header__logo span { color: var(--arancione); }
  .header__nav { display: flex; gap: 1.25rem; }
  .header__nav a { text-decoration: none; color: var(--grigio); text-transform: uppercase; font-size: 0.85rem; font-weight: 700; }
  .header__nav a:hover { color: var(--bianco); }
</style>
```

`src/components/Footer.astro`:
```astro
---
import { TELEFONO_DISPLAY, TELEFONO_TEL, linkWhatsApp } from '../lib/contatti';
---
<footer class="footer">
  <div class="contenitore">
    <p><strong>Motobroker.it</strong> — Intermediazione vendita moto usate tra privati</p>
    <p>
      <a href={TELEFONO_TEL}>{TELEFONO_DISPLAY}</a> ·
      <a href={linkWhatsApp()}>WhatsApp</a>
    </p>
  </div>
</footer>
<style>
  .footer { border-top: 1px solid var(--nero-carta); padding: 2rem 0; margin-top: 4rem; color: var(--grigio); font-size: 0.9rem; }
  .footer a { color: var(--arancione); }
</style>
```

`src/layouts/Layout.astro`:
```astro
---
import '../styles/global.css';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title: string;
  description: string;
  ogImage?: string;
}
const { title, description, ogImage } = Astro.props;
---
<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    {ogImage && <meta property="og:image" content={new URL(ogImage, Astro.site)} />}
  </head>
  <body>
    <Header />
    <main><slot /></main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 3: index.astro minimale con Layout**

`src/pages/index.astro`:
```astro
---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Motobroker.it — Vendi la tua moto" description="Intermediazione vendita moto usate tra privati: sicura, veloce e senza stress.">
  <h1 class="titolo-sezione contenitore">Vendi la tua moto!</h1>
</Layout>
```

- [ ] **Step 4: Verifica build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: design system, layout, header e footer"
```

---

### Task 5: Scheda moto e pagina galleria

**Files:**
- Create: `src/components/SchedaMoto.astro`, `src/pages/moto/index.astro`

**Interfaces:**
- Consumes: collection `moto`, `slugMoto`, `ordinaMoto`, `fotoMoto`, `formattaPrezzo`, `formattaKm`, `url`.
- Produces: `SchedaMoto.astro` con props `{ entry: CollectionEntry<'moto'> }`.

- [ ] **Step 1: Componente scheda**

`src/components/SchedaMoto.astro`:
```astro
---
import { Image } from 'astro:assets';
import type { CollectionEntry } from 'astro:content';
import { fotoMoto } from '../lib/foto';
import { formattaKm, formattaPrezzo } from '../lib/formatta';
import { slugMoto } from '../lib/moto';
import { url } from '../lib/url';

interface Props { entry: CollectionEntry<'moto'> }
const { entry } = Astro.props;
const slug = slugMoto(entry);
const copertina = fotoMoto(slug)[0];
const { marca, modello, anno, km, prezzo, venduta } = entry.data;
---
<a href={url(`/moto/${slug}/`)} class:list={['scheda', { 'scheda--venduta': venduta }]}>
  <div class="scheda__foto">
    {copertina && <Image src={copertina} alt={`${marca} ${modello}`} width={640} widths={[320, 640]} sizes="(max-width: 640px) 100vw, 340px" />}
    {venduta && <span class="scheda__badge">Venduta</span>}
  </div>
  <div class="scheda__info">
    <h3>{marca} {modello}</h3>
    <p class="scheda__dati">{anno}{km !== undefined && ` · ${formattaKm(km)}`}</p>
    <p class="scheda__prezzo">{formattaPrezzo(prezzo)}</p>
  </div>
</a>
<style>
  .scheda { background: var(--nero-carta); border-radius: 10px; overflow: hidden; text-decoration: none; display: block; transition: transform 0.15s; }
  .scheda:hover { transform: translateY(-3px); }
  .scheda__foto { position: relative; aspect-ratio: 3 / 2; }
  .scheda__foto img { width: 100%; height: 100%; object-fit: cover; }
  .scheda--venduta img { filter: grayscale(0.7); opacity: 0.7; }
  .scheda__badge { position: absolute; top: 0.75rem; left: 0.75rem; background: var(--rosso); color: var(--bianco); font-family: var(--font-titoli); text-transform: uppercase; padding: 0.2rem 0.7rem; border-radius: 4px; font-size: 0.85rem; }
  .scheda__info { padding: 1rem; }
  .scheda__info h3 { font-family: var(--font-titoli); text-transform: uppercase; font-size: 1.1rem; }
  .scheda__dati { color: var(--grigio); font-size: 0.9rem; }
  .scheda__prezzo { color: var(--arancione); font-weight: 700; margin-top: 0.3rem; }
</style>
```

- [ ] **Step 2: Pagina galleria**

`src/pages/moto/index.astro`:
```astro
---
import { getCollection } from 'astro:content';
import Layout from '../../layouts/Layout.astro';
import SchedaMoto from '../../components/SchedaMoto.astro';
import { ordinaMoto } from '../../lib/moto';

const moto = ordinaMoto(await getCollection('moto'));
---
<Layout title="Moto in vendita — Motobroker.it" description="Le moto usate attualmente in vendita tramite Motobroker.it.">
  <section class="contenitore galleria">
    <h1 class="titolo-sezione">Moto in vendita</h1>
    {moto.length === 0 && <p>Nessuna moto in vendita al momento. Torna a trovarci presto!</p>}
    <div class="galleria__griglia">
      {moto.map((entry) => <SchedaMoto entry={entry} />)}
    </div>
  </section>
</Layout>
<style>
  .galleria { padding-top: 2.5rem; }
  .galleria__griglia { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.25rem; margin-top: 1.5rem; }
</style>
```

- [ ] **Step 3: Verifica build**

Run: `npm run build`
Expected: OK, `dist/moto/index.html` esiste, contiene "Panigale" e badge "Venduta" per la BMW.
Run: `grep -c "Venduta" dist/moto/index.html`
Expected: ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add src/components/SchedaMoto.astro src/pages/moto
git commit -m "feat: galleria moto con schede e badge venduta"
```

---

### Task 6: Pagina dettaglio moto

**Files:**
- Create: `src/pages/moto/[slug].astro`

**Interfaces:**
- Consumes: collection `moto`, `slugMoto`, `fotoMoto`, `formattaPrezzo`, `formattaKm`, `linkWhatsApp`, `TELEFONO_*`.

- [ ] **Step 1: Pagina dettaglio**

`src/pages/moto/[slug].astro`:
```astro
---
import { Image } from 'astro:assets';
import { getCollection } from 'astro:content';
import Layout from '../../layouts/Layout.astro';
import { TELEFONO_DISPLAY, TELEFONO_TEL, linkWhatsApp } from '../../lib/contatti';
import { fotoMoto } from '../../lib/foto';
import { formattaKm, formattaPrezzo } from '../../lib/formatta';
import { slugMoto } from '../../lib/moto';

export async function getStaticPaths() {
  const moto = await getCollection('moto');
  return moto.map((entry) => ({ params: { slug: slugMoto(entry) }, props: { entry } }));
}

const { entry } = Astro.props;
const slug = slugMoto(entry);
const foto = fotoMoto(slug);
const { marca, modello, anno, km, cilindrata, prezzo, descrizione, venduta } = entry.data;
const nome = `${marca} ${modello}`;
const wa = linkWhatsApp(`Ciao! Vorrei informazioni sulla ${nome} (${anno}) vista su Motobroker.it`);
---
<Layout title={`${nome} — Motobroker.it`} description={`${nome} ${anno} in vendita tramite Motobroker.it`} ogImage={foto[0]?.src}>
  <article class="contenitore dettaglio">
    <h1 class="titolo-sezione">{nome} {venduta && <span class="dettaglio__venduta">Venduta</span>}</h1>
    <div class="dettaglio__foto">
      {foto.map((f, i) => (
        <Image src={f} alt={`${nome} — foto ${i + 1}`} width={1200} widths={[640, 1200]} sizes="(max-width: 700px) 100vw, 700px" loading={i === 0 ? 'eager' : 'lazy'} />
      ))}
    </div>
    <dl class="dettaglio__dati">
      <div><dt>Anno</dt><dd>{anno}</dd></div>
      {km !== undefined && <div><dt>Chilometri</dt><dd>{formattaKm(km)}</dd></div>}
      {cilindrata !== undefined && <div><dt>Cilindrata</dt><dd>{cilindrata} cc</dd></div>}
      <div><dt>Prezzo</dt><dd class="dettaglio__prezzo">{formattaPrezzo(prezzo)}</dd></div>
    </dl>
    {descrizione && <p class="dettaglio__descrizione">{descrizione}</p>}
    {!venduta && (
      <div class="dettaglio__cta">
        <a class="bottone bottone--whatsapp" href={wa}>Chiedi info su WhatsApp</a>
        <a class="bottone" href={TELEFONO_TEL}>Chiama {TELEFONO_DISPLAY}</a>
      </div>
    )}
  </article>
</Layout>
<style>
  .dettaglio { padding-top: 2.5rem; max-width: 760px; }
  .dettaglio__venduta { color: var(--grigio); font-size: 0.6em; vertical-align: middle; }
  .dettaglio__foto { display: grid; gap: 0.75rem; margin: 1.5rem 0; }
  .dettaglio__foto img { border-radius: 10px; width: 100%; height: auto; }
  .dettaglio__dati { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; background: var(--nero-carta); padding: 1.25rem; border-radius: 10px; }
  .dettaglio__dati dt { color: var(--grigio); font-size: 0.8rem; text-transform: uppercase; }
  .dettaglio__dati dd { font-weight: 700; font-size: 1.1rem; }
  .dettaglio__prezzo { color: var(--arancione); }
  .dettaglio__descrizione { margin: 1.5rem 0; white-space: pre-line; }
  .dettaglio__cta { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1.5rem; }
</style>
```

- [ ] **Step 2: Verifica build**

Run: `npm run build`
Expected: OK, esiste `dist/moto/ducati-panigale-v4/index.html` con link `wa.me` precompilato; `dist/moto/bmw-r1250gs/index.html` senza bottoni CTA (venduta).

- [ ] **Step 3: Commit**

```bash
git add src/pages/moto
git commit -m "feat: pagina dettaglio moto con CTA WhatsApp"
```

---

### Task 7: Home page completa

**Files:**
- Create: `src/components/home/Hero.astro`, `src/components/home/Servizi.astro`, `src/components/home/ComeFunziona.astro`, `src/components/home/AnteprimaGalleria.astro`, `src/components/home/ChiSiamo.astro`, `src/components/home/Contatti.astro`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `SchedaMoto`, collection `moto`, `ordinaMoto`, contatti, `url`.
- Produces: componenti home senza props (self-contained).

- [ ] **Step 1: Hero**

`src/components/home/Hero.astro`:
```astro
---
import { TELEFONO_DISPLAY, TELEFONO_TEL, linkWhatsApp } from '../../lib/contatti';
---
<section class="hero">
  <div class="contenitore hero__inner">
    <h1 class="hero__titolo">Vendi<br />la tua moto!</h1>
    <p class="hero__sotto">In modo sicuro, veloce e senza stress</p>
    <p class="hero__claim">Ci occupiamo di tutto noi, <strong>tu ti godi il risultato.</strong></p>
    <div class="hero__cta">
      <a class="bottone" href={TELEFONO_TEL}>Chiama {TELEFONO_DISPLAY}</a>
      <a class="bottone bottone--whatsapp" href={linkWhatsApp('Ciao! Vorrei vendere la mia moto tramite Motobroker.it')}>Scrivici su WhatsApp</a>
    </div>
  </div>
</section>
<style>
  .hero { background: radial-gradient(ellipse at 70% 30%, #2a0d0e 0%, var(--nero) 65%); padding: 4.5rem 0; }
  .hero__titolo { font-family: var(--font-titoli); text-transform: uppercase; color: var(--rosso); font-size: clamp(3rem, 10vw, 5.5rem); line-height: 0.95; }
  .hero__sotto { font-family: var(--font-titoli); text-transform: uppercase; font-size: clamp(1rem, 3vw, 1.5rem); margin-top: 0.75rem; }
  .hero__claim { color: var(--grigio); margin-top: 1rem; max-width: 32ch; }
  .hero__claim strong { color: var(--rosso); }
  .hero__cta { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 2rem; }
</style>
```

- [ ] **Step 2: Servizi**

`src/components/home/Servizi.astro`:
```astro
---
const servizi = [
  { icona: '🔍', titolo: 'Valutazione professionale', testo: 'Valutiamo la tua moto in modo corretto e trasparente.' },
  { icona: '📷', titolo: 'Servizio foto e annunci', testo: 'Realizziamo foto professionali e annunci mirati per la massima visibilità.' },
  { icona: '🤝', titolo: 'Gestione trattativa', testo: 'Selezioniamo le persone seriamente interessate e gestiamo tutta la trattativa.' },
  { icona: '🛡️', titolo: 'Vendita sicura e garantita', testo: 'Garantiamo la massima sicurezza nella vendita e nel pagamento.' },
  { icona: '⏱️', titolo: 'Più veloci, meno pensieri', testo: 'Facciamo risparmiare tempo a tutti: a te e agli acquirenti.' },
];
---
<section class="servizi" id="servizi">
  <div class="contenitore">
    <h2 class="titolo-sezione">I nostri servizi</h2>
    <div class="servizi__griglia">
      {servizi.map((s) => (
        <div class="servizi__voce">
          <span class="servizi__icona">{s.icona}</span>
          <h3>{s.titolo}</h3>
          <p>{s.testo}</p>
        </div>
      ))}
    </div>
  </div>
</section>
<style>
  .servizi { padding: 4rem 0; }
  .servizi__griglia { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-top: 1.5rem; }
  .servizi__voce { background: var(--nero-carta); border-top: 3px solid var(--rosso); border-radius: 0 0 10px 10px; padding: 1.25rem; }
  .servizi__icona { font-size: 1.8rem; }
  .servizi__voce h3 { font-family: var(--font-titoli); text-transform: uppercase; color: var(--rosso); font-size: 1rem; margin: 0.5rem 0; }
  .servizi__voce p { color: var(--grigio); font-size: 0.92rem; }
</style>
```

- [ ] **Step 3: Come funziona**

`src/components/home/ComeFunziona.astro`:
```astro
---
const passi = [
  { n: 1, titolo: 'Contattaci', testo: 'Chiamaci o scrivici su WhatsApp: ci racconti la tua moto.' },
  { n: 2, titolo: 'Valutazione', testo: 'Valutiamo la moto e concordiamo insieme il prezzo di vendita.' },
  { n: 3, titolo: 'Foto e annuncio', testo: 'Realizziamo foto professionali e pubblichiamo annunci mirati.' },
  { n: 4, titolo: 'Vendita gestita', testo: 'Gestiamo trattativa, documenti e pagamento in sicurezza. Tu incassi.' },
];
---
<section class="passi">
  <div class="contenitore">
    <h2 class="titolo-sezione">Come funziona</h2>
    <ol class="passi__lista">
      {passi.map((p) => (
        <li>
          <span class="passi__numero">{p.n}</span>
          <h3>{p.titolo}</h3>
          <p>{p.testo}</p>
        </li>
      ))}
    </ol>
  </div>
</section>
<style>
  .passi { padding: 4rem 0; background: var(--nero-carta); }
  .passi__lista { list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
  .passi__numero { font-family: var(--font-titoli); font-size: 2.5rem; color: var(--arancione); }
  .passi__lista h3 { font-family: var(--font-titoli); text-transform: uppercase; font-size: 1rem; margin: 0.25rem 0; }
  .passi__lista p { color: var(--grigio); font-size: 0.92rem; }
</style>
```

- [ ] **Step 4: Anteprima galleria, Chi siamo, Contatti**

`src/components/home/AnteprimaGalleria.astro`:
```astro
---
import { getCollection } from 'astro:content';
import SchedaMoto from '../SchedaMoto.astro';
import { ordinaMoto } from '../../lib/moto';
import { url } from '../../lib/url';

const moto = ordinaMoto(await getCollection('moto')).slice(0, 3);
---
{moto.length > 0 && (
  <section class="anteprima">
    <div class="contenitore">
      <h2 class="titolo-sezione">Moto in vendita</h2>
      <div class="anteprima__griglia">
        {moto.map((entry) => <SchedaMoto entry={entry} />)}
      </div>
      <a class="bottone anteprima__tutte" href={url('/moto/')}>Vedi tutte le moto</a>
    </div>
  </section>
)}
<style>
  .anteprima { padding: 4rem 0; }
  .anteprima__griglia { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.25rem; margin: 1.5rem 0; }
  .anteprima__tutte { margin-top: 0.5rem; }
</style>
```

`src/components/home/ChiSiamo.astro`:
```astro
<section class="chisiamo">
  <div class="contenitore">
    <h2 class="titolo-sezione">Chi siamo</h2>
    <p class="chisiamo__testo">
      Motobroker.it nasce dalla passione per le due ruote: aiutiamo chi vuole vendere la propria
      moto a farlo al giusto prezzo, senza perdite di tempo e senza rischi. Non lasciare che la
      tua moto perda valore: affidati a chi sa come venderla al meglio.
    </p>
    <!-- TODO contenuto reale: sostituire con presentazione e recensioni vere -->
  </div>
</section>
<style>
  .chisiamo { padding: 4rem 0; background: var(--nero-carta); }
  .chisiamo__testo { max-width: 60ch; margin-top: 1rem; color: var(--grigio); }
</style>
```

`src/components/home/Contatti.astro`:
```astro
---
import { TELEFONO_DISPLAY, TELEFONO_TEL, linkWhatsApp } from '../../lib/contatti';
---
<section class="contatti" id="contatti">
  <div class="contenitore">
    <h2 class="titolo-sezione">Contattaci</h2>
    <p class="contatti__testo">Chiama o manda un messaggio: rispondiamo tutti i giorni.</p>
    <p class="contatti__numero"><a href={TELEFONO_TEL}>{TELEFONO_DISPLAY}</a></p>
    <a class="bottone bottone--whatsapp" href={linkWhatsApp('Ciao! Vi contatto da Motobroker.it')}>Scrivici su WhatsApp</a>
  </div>
</section>
<style>
  .contatti { padding: 4rem 0; text-align: center; }
  .contatti__testo { color: var(--grigio); margin-top: 0.75rem; }
  .contatti__numero a { font-family: var(--font-titoli); font-size: clamp(2rem, 7vw, 3.2rem); color: var(--bianco); text-decoration: none; }
  .contatti__numero { margin: 0.75rem 0 1.25rem; }
</style>
```

- [ ] **Step 5: Componi la home**

`src/pages/index.astro`:
```astro
---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/home/Hero.astro';
import Servizi from '../components/home/Servizi.astro';
import ComeFunziona from '../components/home/ComeFunziona.astro';
import AnteprimaGalleria from '../components/home/AnteprimaGalleria.astro';
import ChiSiamo from '../components/home/ChiSiamo.astro';
import Contatti from '../components/home/Contatti.astro';
---
<Layout
  title="Motobroker.it — Vendi la tua moto in modo sicuro, veloce e senza stress"
  description="Intermediazione vendita moto usate tra privati: valutazione professionale, foto e annunci, trattativa gestita, vendita sicura e garantita."
>
  <Hero />
  <Servizi />
  <ComeFunziona />
  <AnteprimaGalleria />
  <ChiSiamo />
  <Contatti />
</Layout>
```

- [ ] **Step 6: Verifica build**

Run: `npm run build`
Expected: OK, `dist/index.html` contiene "VENDI" (o "Vendi la tua moto"), i 5 servizi, il numero di telefono.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: home page completa con hero, servizi e contatti"
```

---

### Task 8: Config GitHub Pages + workflow deploy

**Files:**
- Modify: `astro.config.mjs`
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: username GitHub (ricavato con `gh api user -q .login`).

- [ ] **Step 1: Ricava username GitHub**

Run: `gh api user -q .login`
Expected: stampa lo username (usato come `<USERNAME>` sotto).

- [ ] **Step 2: Configura site/base**

`astro.config.mjs` (sostituisci `<USERNAME>`):
```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://<USERNAME>.github.io',
  base: '/MotoBroker',
});
```

Nota: quando si collegherà il dominio motobroker.it, cambiare in `site: 'https://motobroker.it'`, rimuovere `base` e aggiungere `public/CNAME` con `motobroker.it`.

- [ ] **Step 3: Workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy su GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: withastro/action@v3

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Verifica build locale con base**

Run: `npm run build && npm test`
Expected: build OK, test PASS. Controlla che i link in `dist/index.html` puntino a `/MotoBroker/moto/`.

- [ ] **Step 5: Commit**

```bash
git add astro.config.mjs .github
git commit -m "ci: deploy automatico su GitHub Pages"
```

- [ ] **Step 6: Crea repo e push (chiedi conferma all'utente prima)**

```bash
gh repo create MotoBroker --public --source . --push
gh api repos/<USERNAME>/MotoBroker/pages -X POST -f build_type=workflow || true
```
Expected: repo creato, workflow parte, sito su `https://<USERNAME>.github.io/MotoBroker/`.

---

### Task 9: README con istruzioni aggiornamento galleria

**Files:**
- Create: `README.md`

- [ ] **Step 1: Scrivi README**

`README.md`:
````markdown
# Motobroker.it

Sito vetrina statico (Astro) con galleria moto generata dalle cartelle in `moto/`.

## Aggiungere una moto

1. Crea una cartella in `moto/` con nome tipo `marca-modello` (diventa l'URL):
   `moto/ducati-panigale-v4/`
2. Metti dentro le foto (`.jpg`, `.png`, `.webp`). La prima in ordine alfabetico è la copertina — nominale `01.jpg`, `02.jpg`, ...
3. Crea `info.yaml`:

```yaml
marca: Ducati
modello: Panigale V4
anno: 2022
km: 8500          # opzionale
cilindrata: 1103  # opzionale
prezzo: 21500     # opzionale: se manca mostra "Prezzo su richiesta"
descrizione: >    # opzionale
  Condizioni, accessori, tagliandi...
venduta: false    # true = badge VENDUTA
```

4. Commit e push: il sito si aggiorna da solo in ~2 minuti.

```bash
git add moto && git commit -m "feat: aggiungi <moto>" && git push
```

## Moto venduta

Metti `venduta: true` in `info.yaml` (resta visibile con badge). Per toglierla del tutto, elimina la cartella.

## Sviluppo

```bash
npm install
npm run dev    # http://localhost:4321
npm test
npm run build
```

## Dominio motobroker.it

Quando pronto: in `astro.config.mjs` imposta `site: 'https://motobroker.it'` e rimuovi `base`; crea `public/CNAME` con `motobroker.it`; configura DNS (CNAME `www` → `<USERNAME>.github.io`, A records apex GitHub Pages) e imposta il custom domain nelle impostazioni Pages del repo.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: istruzioni aggiornamento galleria"
```

---

## Verifica finale

- [ ] `npm test` — tutti PASS
- [ ] `npm run build` — OK
- [ ] Home, `/moto/`, dettaglio: contenuti corretti in `dist/`
- [ ] Workflow GitHub Actions verde, sito raggiungibile
