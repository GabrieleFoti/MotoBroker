// E2E del pannello /admin: crea un utente Cognito di test, fa il primo accesso (cambio
// password), crea una moto con 2 foto, la modifica, la segna venduta, la elimina — tutto
// contro il branch di prova `cms-test` (mai `main`). Cancella sempre l'utente alla fine.
//
// Uso: con `npm run dev` acceso su :4321 (VITE_CMS_GITHUB_BRANCH=cms-test) e la Lambda
// `motobroker-cms` con GITHUB_BRANCH=cms-test:
//   node scripts/e2e-admin.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const POOL = 'us-east-1_VsUpLgY2g';
const BASE = 'http://localhost:4321/admin/';
const OUT = fileURLToPath(new URL('../docs/screenshots/admin/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const stamp = Date.now();
const EMAIL = `qa-hermes-${stamp}@example.com`;
const TMP = 'TempPass12345';
const NEW = 'NuovaPass12345';
const MARCA = 'QA Hermes';
const MODELLO = `Test ${stamp}`;
const SLUG = `qa-hermes-test-${stamp}`;
// Due immagini JPEG/PNG qualsiasi, non versionate nel repo: passa il percorso con
// E2E_FIXTURES_DIR (deve contenere foto1.png e foto2.png), default /tmp/e2e-fixtures.
const FOTO_DIR = (process.env.E2E_FIXTURES_DIR || '/tmp/e2e-fixtures') + '/';

// Shell exec è sicuro qui: `args` viene sempre da stringhe costanti definite in questo file
// (EMAIL/TMP/NEW derivano da Date.now(), nessun input utente), stesso pattern di
// bertoniassociati/scripts/test-newpw.mjs.
const aws = (args) =>
  execSync(`aws cognito-idp ${args} --profile Zentrya --region us-east-1 --user-pool-id ${POOL}`, { stdio: 'pipe' }).toString();

function log(...a) {
  console.log('[e2e]', ...a);
}

let browser;
let userCreated = false;
let failed = null;

try {
  aws(
    `admin-create-user --username ${EMAIL} --temporary-password ${TMP} --message-action SUPPRESS ` +
      `--user-attributes Name=email,Value=${EMAIL} Name=email_verified,Value=true`
  );
  userCreated = true;
  log('utente di test creato:', EMAIL);

  browser = await chromium.launch();

  // ---- desktop: login + primo accesso ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}01-login.png` });

  await page.fill('#f-email', EMAIL);
  await page.fill('#f-pw', TMP);
  await page.click('button[type=submit]');

  await page.waitForSelector('#f-npw', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}02-primo-accesso.png` });
  await page.fill('#f-npw', NEW);
  await page.click('button[type=submit]');

  await page.waitForSelector('text=Nuova moto', { timeout: 20000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Caricamento'), { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}03-elenco.png` });

  const status = JSON.parse(aws(`admin-get-user --username ${EMAIL}`)).UserStatus;
  log('stato utente dopo cambio password:', status);
  if (status !== 'CONFIRMED') throw new Error(`stato utente inatteso dopo NEW_PASSWORD_REQUIRED: ${status}`);

  // ---- crea moto con 2 foto ----
  await page.click('text=+ Nuova moto');
  await page.waitForSelector('text=Nuova moto', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}04-form-vuoto.png` });

  const fields = await page.$$('input.admin-input');
  // ordine nel form: marca, modello, anno, km, cilindrata, prezzo
  await fields[0].fill(MARCA);
  await fields[1].fill(MODELLO);
  await fields[2].fill('');
  await fields[2].fill('2024');
  await fields[3].fill('1234');
  await fields[4].fill('500');
  await fields[5].fill('9999');
  await page.fill('textarea.admin-textarea', 'Descrizione di prova e2e.\nSeconda riga.');

  await page.setInputFiles('input[type=file]', [`${FOTO_DIR}foto1.png`, `${FOTO_DIR}foto2.png`]);
  await page.waitForFunction(() => document.querySelectorAll('.admin-thumb').length === 2, { timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('.admin-progress') && document.querySelectorAll('.admin-thumb').length === 2,
    { timeout: 20000 }
  );
  await page.screenshot({ path: `${OUT}05-form-compilato.png` });

  await page.click('button[type=submit].admin-btn:not([disabled])');
  await page.waitForSelector('text=Salvato', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}06-dopo-creazione.png` });
  log('moto creata, slug atteso:', SLUG);

  // ---- verifica presente in elenco, poi modifica ----
  await page.fill('.admin-search', MODELLO);
  await page.waitForSelector(`text=${MARCA} ${MODELLO}`, { timeout: 10000 });
  await page.click(`text=Modifica`);
  await page.waitForSelector('text=Modifica moto', { timeout: 10000 });

  const editFields = await page.$$('input.admin-input');
  await editFields[5].fill('8888'); // prezzo
  // rimuovi la seconda foto (locator, non ElementHandle: resta valido dopo il re-render)
  await page.locator('.admin-thumb').nth(1).locator('.admin-thumb-bar button').click();
  await page.waitForFunction(() => document.querySelectorAll('.admin-thumb').length === 1);
  await page.screenshot({ path: `${OUT}07-form-modifica.png` });
  await page.click('button[type=submit].admin-btn:not([disabled])');
  await page.waitForSelector('text=Salvato', { timeout: 20000 });
  log('moto modificata (prezzo + 1 foto rimossa)');

  // ---- toggle venduta dall'elenco ----
  await page.fill('.admin-search', MODELLO);
  await page.waitForSelector('text=Segna venduta', { timeout: 10000 });
  await page.click('text=Segna venduta');
  await page.waitForSelector('text=Venduta', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}08-elenco-venduta.png` });
  log('moto segnata venduta dal toggle rapido');

  // ---- mobile 390px ----
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('console', (m) => m.type() === 'error' && consoleErrors.push(`mobile: ${m.text()}`));
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.fill('#f-email', EMAIL);
  await mobile.fill('#f-pw', NEW);
  await mobile.click('button[type=submit]');
  await mobile.waitForSelector('text=Nuova moto', { timeout: 20000 });
  await mobile.waitForFunction(() => !document.body.innerText.includes('Caricamento'), { timeout: 15000 });
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: `${OUT}09-mobile-elenco.png` });
  await mobile.fill('.admin-search', MODELLO);
  await mobile.waitForSelector('text=Modifica', { timeout: 10000 });
  await mobile.click('text=Modifica');
  await mobile.waitForSelector('text=Modifica moto', { timeout: 10000 });
  await mobile.screenshot({ path: `${OUT}10-mobile-form.png` });

  // ---- elimina (dal pannello mobile, poi verifica) ----
  // force:true: la dev toolbar di Astro (solo in sviluppo, assente in build) intercetta
  // i click vicino al bordo dello schermo.
  await mobile.click('text=Elimina moto', { force: true });
  await mobile.waitForSelector('text=Confermo, elimina', { timeout: 5000 });
  await mobile.click('text=Confermo, elimina', { force: true });
  await mobile.waitForSelector('text=Moto eliminata', { timeout: 20000 });
  log('moto eliminata');
  await mobile.close();

  if (consoleErrors.length) log('AVVISO errori console/pageerror:', consoleErrors);

  log('E2E completato con successo.');
} catch (err) {
  failed = err;
  console.error('[e2e] FALLITO:', err);
} finally {
  if (browser) await browser.close();
  if (userCreated) {
    try {
      aws(`admin-delete-user --username ${EMAIL}`);
      log('utente di test cancellato:', EMAIL);
    } catch (e) {
      console.error('[e2e] ATTENZIONE: cancellazione utente fallita, rimuoverlo a mano:', EMAIL, e.message);
    }
  }
}
process.exit(failed ? 1 : 0);
