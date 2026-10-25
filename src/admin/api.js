// Client per l'API del CMS (infra/lambda/index.mjs). Tutte le rotte dietro Cognito JWT.
import { CMS_CONFIG } from './config.js';
import { getIdToken } from './cognito.js';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function authedFetch(path, options = {}) {
  const idToken = await getIdToken();
  const res = await fetch(CMS_CONFIG.apiUrl + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      authorization: `Bearer ${idToken}`,
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // risposta senza body
  }
  if (!res.ok) throw new ApiError(body?.error || `Errore ${res.status}`, res.status, body);
  return body;
}

// -> { headSha, moto: [{slug, marca, modello, anno, km?, cilindrata?, prezzo?, descrizione?, venduta, foto[]}] }
export function getMoto() {
  return authedFetch('/moto', { method: 'GET' });
}

// base64Content: solo la parte dopo la virgola di un data URL. -> { sha, format, receipt }
// receipt: HMAC dello sha firmata dalla Lambda col token GitHub; va rimandata nel PUT per
// le foto nuove, altrimenti la Lambda rifiuta lo sha con 400 ("manca la ricevuta").
export function createBlob(base64Content) {
  return authedFetch('/blobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
  });
}

// photos: [{ name }] o [{ name, sha }] per foto già nella cartella (la Lambda la ritrova per
// nome/sha); [{ name, sha, receipt }] per foto nuove appena caricate con /blobs.
// create: true solo per una moto nuova (slug = slugify(marca-modello), 409 SLUG_EXISTS se esiste già).
// previousSlug: presente solo per una rinomina esplicita confermata dall'utente (409 SLUG_EXISTS
// se la destinazione esiste, 404 se l'origine non esiste). Senza create né previousSlug è un
// aggiornamento in place: lo slug resta quello della cartella, 404 se non esiste.
export function saveMoto({ slug, headSha, data, photos, previousSlug, create }) {
  return authedFetch(`/moto/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      headSha,
      data,
      photos,
      ...(previousSlug ? { previousSlug } : {}),
      ...(create ? { create: true } : {}),
    }),
  });
}

export function deleteMoto(slug, headSha) {
  return authedFetch(`/moto/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ headSha }),
  });
}

// -> { status, conclusion, htmlUrl, updatedAt } oppure { status: null, conclusion: null }
export function getDeployStatus() {
  return authedFetch('/deploy-status', { method: 'GET' });
}
