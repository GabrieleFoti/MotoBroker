// Lambda motobroker-cms
// Node.js 22, ESM, solo AWS SDK v3 (già presente nel runtime Lambda) + fetch globale
// (disponibile in Node 18+) per parlare con l'API REST/Git Data di GitHub.
// Unica dipendenza oltre all'SDK: js-yaml (lo stesso parser di Astro), copiato nello zip da deploy.sh.
//
// Routes (dietro API Gateway HTTP API con authorizer JWT Cognito su tutte le rotte):
//   GET    /moto        -> elenco moto letto da `main` (slug, campi info.yaml, foto) + headSha
//   POST   /blobs        -> crea un blob Git da un'immagine base64, ritorna lo sha
//   PUT    /moto/{slug}  -> un solo commit che scrive moto/<slug>/info.yaml + foto
//   DELETE /moto/{slug}  -> un solo commit che rimuove moto/<slug>/
//   GET    /deploy-status -> stato dell'ultima run del workflow Pages
//
// Il repo è l'archivio dati: niente database, niente storage immagini dedicato.
// Il token GitHub (fine-grained PAT, solo Contents read/write su questo repo) vive in
// Secrets Manager (`motobroker/github-token`), MAI nel codice/log.

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import {
  SLUG_RE,
  PHOTO_NAME_RE,
  slugify,
  validateMotoData,
  detectImageFormat,
  serializeInfoYaml,
  parseInfoYaml,
  unknownFields,
  KNOWN_FIELDS,
  blobReceipt,
  checkReceipt,
} from './lib.mjs'

export { slugify, validateMotoData, detectImageFormat, serializeInfoYaml, parseInfoYaml }

const REGION = process.env.AWS_REGION
const OWNER = process.env.GITHUB_OWNER || 'GabrieleFoti'
const REPO = process.env.GITHUB_REPO || 'MotoBroker'
const BRANCH = process.env.GITHUB_BRANCH || 'main'
const TOKEN_SECRET_ID = process.env.GITHUB_TOKEN_SECRET_ID || 'motobroker/github-token'
const WORKFLOW_FILE = process.env.WORKFLOW_FILE || 'deploy.yml'
const MAX_BLOB_B64_CHARS = 4 * 1024 * 1024 // ~4MB di testo base64, come richiesto

const secretsClient = new SecretsManagerClient({ region: REGION })
let cachedToken = null

async function getGithubToken() {
  if (cachedToken) return cachedToken
  const out = await secretsClient.send(new GetSecretValueCommand({ SecretId: TOKEN_SECRET_ID }))
  const value = out.SecretString
  if (!value) throw new Error('secret github-token vuoto')
  cachedToken = value.trim()
  return cachedToken
}

// ---- helpers HTTP ----

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

function badRequest(msg) {
  return json(400, { error: msg })
}

function notFound(msg = 'non trovato') {
  return json(404, { error: msg })
}

function conflict(msg = 'conflitto: la testa del branch è cambiata, ricarica e riprova') {
  return json(409, { error: msg, code: 'HEAD_MOVED' })
}

// ---- GitHub API ----

async function gh(path, opts = {}) {
  const r = await ghOnce(path, opts)
  // PAT ruotato in Secrets Manager: svuota la cache e riprova una volta, senza redeploy.
  if (r.status === 401 && opts.auth !== false && cachedToken) {
    cachedToken = null
    return ghOnce(path, opts)
  }
  return r
}

async function ghOnce(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'motobroker-cms-lambda',
  }
  if (auth) {
    const token = await getGithubToken()
    headers.authorization = `Bearer ${token}`
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  return { status: res.status, ok: res.ok, data }
}

class GithubError extends Error {
  constructor(status, data) {
    super(`GitHub API error ${status}: ${JSON.stringify(data)}`)
    this.status = status
    this.data = data
  }
}

async function ghOrThrow(path, opts) {
  const r = await gh(path, opts)
  if (!r.ok) throw new GithubError(r.status, r.data)
  return r.data
}

async function getBranchHead(branch) {
  const ref = await ghOrThrow(`/repos/${OWNER}/${REPO}/git/ref/${encodeURIComponent(`heads/${branch}`)}`)
  return ref.object.sha
}

async function getCommit(sha) {
  return ghOrThrow(`/repos/${OWNER}/${REPO}/git/commits/${sha}`)
}

async function getTreeRecursive(treeSha) {
  const tree = await ghOrThrow(`/repos/${OWNER}/${REPO}/git/trees/${treeSha}?recursive=1`)
  // Albero troncato = elenco file incompleto: PUT/DELETE potrebbero lasciare residui.
  if (tree.truncated) throw new Error('albero Git troncato da GitHub: operazione annullata')
  return tree.tree // [{path, mode, type, sha, size}]
}

async function getBlobContent(sha) {
  const blob = await ghOrThrow(`/repos/${OWNER}/${REPO}/git/blobs/${sha}`)
  return Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8')
}

async function createBlob(content, encoding) {
  return ghOrThrow(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: { content, encoding } })
}

async function createTree(baseTreeSha, entries) {
  return ghOrThrow(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: entries },
  })
}

async function createCommit(message, treeSha, parentSha) {
  return ghOrThrow(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: { message, tree: treeSha, parents: [parentSha] },
  })
}

// aggiorna il ref con force:false -> se nel frattempo qualcun altro ha scritto, GitHub
// risponde 422/"not a fast forward" e qui lo trasformiamo in 409 applicativo.
async function updateRef(branch, sha) {
  const r = await gh(`/repos/${OWNER}/${REPO}/git/refs/${encodeURIComponent(`heads/${branch}`)}`, {
    method: 'PATCH',
    body: { sha, force: false },
  })
  if (r.status === 422 || r.status === 409) return { conflict: true }
  if (!r.ok) throw new GithubError(r.status, r.data)
  return { conflict: false }
}

// ---- utente dall'authorizer JWT ----

function userEmail(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims
  return claims?.email || claims?.['cognito:username'] || 'utente'
}

// ---- handlers ----

async function handleGetMoto() {
  const headSha = await getBranchHead(BRANCH)
  const commit = await getCommit(headSha)
  const tree = await getTreeRecursive(commit.tree.sha)

  const bySlug = new Map()
  for (const entry of tree) {
    if (entry.type !== 'blob') continue
    const m = entry.path.match(/^moto\/([^/]+)\/(.+)$/)
    if (!m) continue
    const [, slug, filename] = m
    if (!bySlug.has(slug)) bySlug.set(slug, { info: null, files: [] })
    const bucket = bySlug.get(slug)
    if (filename === 'info.yaml') bucket.info = entry
    else bucket.files.push(filename)
  }

  const entries = [...bySlug].filter(([, b]) => b.info)
  const texts = await Promise.all(entries.map(([, b]) => getBlobContent(b.info.sha)))
  const moto = []
  for (const [k, [slug, bucket]] of entries.entries()) {
    const fields = parseInfoYaml(texts[k])
    const ordine = (fields.foto || []).filter((n) => bucket.files.includes(n))
    const resto = bucket.files.filter((n) => !ordine.includes(n)).sort()
    moto.push({
      slug,
      marca: fields.marca,
      modello: fields.modello,
      anno: fields.anno,
      km: fields.km,
      cilindrata: fields.cilindrata,
      prezzo: fields.prezzo,
      descrizione: fields.descrizione,
      venduta: Boolean(fields.venduta),
      foto: [...ordine, ...resto],
    })
  }
  moto.sort((a, b) => a.slug.localeCompare(b.slug))

  return json(200, { headSha, moto })
}

async function handleCreateBlob(payload) {
  if (!payload || typeof payload !== 'object') return badRequest('body JSON mancante')
  const { content, encoding } = payload
  if (encoding !== 'base64') return badRequest('encoding deve essere "base64"')
  if (typeof content !== 'string' || !content) return badRequest('content mancante')
  if (content.length > MAX_BLOB_B64_CHARS) return badRequest('immagine troppo grande (max ~4MB in base64)')

  let buf
  try {
    buf = Buffer.from(content, 'base64')
  } catch {
    return badRequest('content non è base64 valido')
  }
  const format = detectImageFormat(buf)
  if (!format) return badRequest('formato immagine non consentito (solo jpeg, png, webp)')

  const blob = await createBlob(content, 'base64')
  return json(200, { sha: blob.sha, format, receipt: blobReceipt(blob.sha, await getGithubToken()) })
}

function folderFiles(tree, slug) {
  const prefix = `moto/${slug}/`
  return tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
}

// Tre casi espliciti, così una moto non può mai sovrascriverne un'altra:
//   create: true           -> nuova moto; slug = slugify(marca-modello); 409 se la cartella esiste
//   previousSlug != slug   -> rinomina esplicita; slug = slugify(marca-modello); 404 se l'origine
//                             non esiste, 409 se la destinazione esiste
//   altrimenti             -> aggiornamento in place; lo slug resta quello della cartella
//                             (come Decap: marca/modello possono cambiare senza cambiare l'URL)
async function handlePutMoto(slug, payload, event) {
  if (!SLUG_RE.test(slug)) return badRequest('slug non valido nell\'URL')
  if (!payload || typeof payload !== 'object') return badRequest('body JSON mancante')
  const { headSha, data, photos, previousSlug, create } = payload

  if (typeof headSha !== 'string' || !headSha) return badRequest('headSha mancante')
  if (create !== undefined && typeof create !== 'boolean') return badRequest('create deve essere booleano')
  const dataErr = validateMotoData(data)
  if (dataErr) return badRequest(`data non valido: ${dataErr}`)

  if (previousSlug !== undefined && previousSlug !== null) {
    if (typeof previousSlug !== 'string' || !SLUG_RE.test(previousSlug))
      return badRequest('previousSlug non valido')
    if (create) return badRequest('create e previousSlug non possono stare insieme')
  }
  const isRename = Boolean(previousSlug) && previousSlug !== slug
  if (create || isRename) {
    const expectedSlug = slugify(`${data.marca}-${data.modello}`)
    if (expectedSlug !== slug) return badRequest(`slug non corrisponde a marca/modello (atteso: ${expectedSlug})`)
  }

  if (!Array.isArray(photos)) return badRequest('photos deve essere un array')
  for (const p of photos) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !PHOTO_NAME_RE.test(p.name))
      return badRequest(`nome foto non valido: ${p && p.name}`)
    if (p.sha !== undefined && (typeof p.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(p.sha)))
      return badRequest(`sha foto non valido per ${p.name}`)
  }
  const names = photos.map((p) => p.name)
  if (new Set(names).size !== names.length) return badRequest('nomi foto duplicati')

  const currentHead = await getBranchHead(BRANCH)
  if (currentHead !== headSha) return conflict()

  const commit = await getCommit(currentHead)
  const tree = await getTreeRecursive(commit.tree.sha)

  const sourceSlug = isRename ? previousSlug : slug
  const targetExists = folderFiles(tree, slug).length > 0
  const sourceFiles = create ? [] : folderFiles(tree, sourceSlug)
  if (create && targetExists)
    return json(409, { error: `esiste già una moto "${slug}"`, code: 'SLUG_EXISTS' })
  if (!create && sourceFiles.length === 0) return notFound(`moto "${sourceSlug}" non trovata`)
  if (isRename && targetExists)
    return json(409, { error: `esiste già una moto "${slug}"`, code: 'SLUG_EXISTS' })

  // Il file attuale ha campi che il pannello non conosce? Riscriverlo li perderebbe:
  // meglio rifiutare e farlo sistemare a mano.
  const currentInfo = sourceFiles.find((e) => e.path === `moto/${sourceSlug}/info.yaml`)
  if (currentInfo) {
    const extra = unknownFields(parseInfoYaml(await getBlobContent(currentInfo.sha)))
    if (extra.length)
      return json(422, { error: `info.yaml contiene campi non gestiti dal pannello: ${extra.join(', ')}`, code: 'UNKNOWN_FIELDS' })
  }

  const existingBySha = new Set(sourceFiles.map((e) => e.sha))
  const key = await getGithubToken()
  const entries = []
  for (const p of photos) {
    let sha = p.sha
    if (sha) {
      // sha nuovo: serve la ricevuta di /blobs; sha di un file già nella cartella: ok
      if (!existingBySha.has(sha) && !checkReceipt(sha, p.receipt, key))
        return badRequest(`foto "${p.name}": manca la ricevuta di caricamento valida`)
    } else {
      const entry = sourceFiles.find((e) => e.path === `moto/${sourceSlug}/${p.name}`)
      if (!entry) return badRequest(`foto "${p.name}" senza sha e non trovata nel repo`)
      sha = entry.sha
    }
    entries.push({ path: `moto/${slug}/${p.name}`, mode: '100644', type: 'blob', sha })
  }

  // Dal client si prendono solo i campi noti (eventuali extra, es. lo slug, si ignorano).
  const clean = Object.fromEntries(KNOWN_FIELDS.filter((k) => k !== 'foto' && data[k] !== undefined).map((k) => [k, data[k]]))
  const yamlContent = serializeInfoYaml({ ...clean, foto: names })
  const infoBlob = await createBlob(Buffer.from(yamlContent, 'utf-8').toString('base64'), 'base64')
  entries.push({ path: `moto/${slug}/info.yaml`, mode: '100644', type: 'blob', sha: infoBlob.sha })

  // rimuovi dalla cartella d'origine ciò che non è più elencato (rinomina: tutta la vecchia cartella)
  const keepPaths = new Set(entries.map((e) => e.path))
  for (const e of sourceFiles) {
    if (isRename || !keepPaths.has(e.path)) entries.push({ path: e.path, mode: '100644', type: 'blob', sha: null })
  }

  const newTree = await createTree(commit.tree.sha, entries)
  const verb = create ? 'crea' : isRename ? `rinomina ${previousSlug} ->` : 'aggiorna'
  const message = `cms: ${verb} ${slug} (${userEmail(event)})`
  const newCommit = await createCommit(message, newTree.sha, currentHead)
  const refResult = await updateRef(BRANCH, newCommit.sha)
  if (refResult.conflict) return conflict()

  return json(200, { ok: true, slug, commitSha: newCommit.sha, headSha: newCommit.sha })
}

async function handleDeleteMoto(slug, payload, event) {
  if (!SLUG_RE.test(slug)) return badRequest('slug non valido nell\'URL')
  if (!payload || typeof payload !== 'object') return badRequest('body JSON mancante')
  const { headSha } = payload
  if (typeof headSha !== 'string' || !headSha) return badRequest('headSha mancante')

  const currentHead = await getBranchHead(BRANCH)
  if (currentHead !== headSha) return conflict()

  const commit = await getCommit(currentHead)
  const tree = await getTreeRecursive(commit.tree.sha)
  const prefix = `moto/${slug}/`
  const toDelete = tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
  if (toDelete.length === 0) return notFound(`moto "${slug}" non trovata`)

  const entries = toDelete.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: null }))
  const newTree = await createTree(commit.tree.sha, entries)
  const message = `cms: elimina ${slug} (${userEmail(event)})`
  const newCommit = await createCommit(message, newTree.sha, currentHead)
  const refResult = await updateRef(BRANCH, newCommit.sha)
  if (refResult.conflict) return conflict()

  return json(200, { ok: true, slug, commitSha: newCommit.sha, headSha: newCommit.sha })
}

async function handleDeployStatus() {
  // Prima col token (quota 5000/h); se il PAT non può leggere Actions, lettura anonima
  // (repo pubblico, quota 60/h per IP condivisa). Se fallisce anche quella: stato sconosciuto,
  // non un errore, così il polling del pannello non mostra un 502.
  const path = `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?branch=${encodeURIComponent(BRANCH)}&per_page=1`
  let r = await gh(path)
  if (!r.ok) r = await gh(path, { auth: false })
  if (!r.ok) return json(200, { status: 'unknown', conclusion: null })
  const run = r.data?.workflow_runs?.[0]
  if (!run) return json(200, { status: null, conclusion: null })
  return json(200, {
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    updatedAt: run.updated_at,
  })
}

// ---- router ----

function parseBody(event) {
  if (!event.body) return {}
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body
  return JSON.parse(raw)
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method
  const path = event?.requestContext?.http?.path || event?.rawPath || ''

  try {
    if (method === 'GET' && path === '/moto') return await handleGetMoto()
    if (method === 'GET' && path === '/deploy-status') return await handleDeployStatus()

    if (method === 'POST' && path === '/blobs') {
      let payload
      try {
        payload = parseBody(event)
      } catch {
        return badRequest('JSON non valido')
      }
      return await handleCreateBlob(payload)
    }

    const motoMatch = path.match(/^\/moto\/([^/]+)$/)
    if (motoMatch) {
      let slug
      try {
        slug = decodeURIComponent(motoMatch[1])
      } catch {
        return badRequest('slug non valido nell\'URL')
      }
      let payload
      try {
        payload = parseBody(event)
      } catch {
        return badRequest('JSON non valido')
      }
      if (method === 'PUT') return await handlePutMoto(slug, payload, event)
      if (method === 'DELETE') return await handleDeleteMoto(slug, payload, event)
    }

    return notFound('rotta non trovata')
  } catch (e) {
    if (e instanceof GithubError) {
      console.error('errore GitHub API', e.status, e.data)
      return json(502, { error: 'errore nel comunicare con GitHub' })
    }
    console.error('errore non gestito', e)
    return json(500, { error: 'errore interno' })
  }
}
