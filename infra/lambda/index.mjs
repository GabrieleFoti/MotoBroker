// Lambda motobroker-cms
// Node.js 22, ESM, solo AWS SDK v3 (già presente nel runtime Lambda) + fetch globale
// (disponibile in Node 18+) per parlare con l'API REST/Git Data di GitHub.
// Nessuna dipendenza extra: niente node_modules nello zip.
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
  return json(409, { error: msg })
}

// ---- GitHub API ----

async function gh(path, { method = 'GET', body, auth = true } = {}) {
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

// ---- YAML minimale, stesso stile dei file esistenti (chiavi fisse, no commenti) ----

function yamlScalar(v) {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return String(v)
  const s = String(v)
  const needsQuote =
    s === '' ||
    s !== s.trim() ||
    /^[\s"'>|*&!%#@,\[\]{}?:-]/.test(s) ||
    /: |:$/.test(s) ||
    /^(true|false|null|~|\d+(\.\d+)?)$/i.test(s)
  if (!needsQuote) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function serializeInfoYaml(data) {
  const lines = []
  lines.push(`marca: ${yamlScalar(data.marca)}`)
  lines.push(`modello: ${yamlScalar(data.modello)}`)
  lines.push(`anno: ${yamlScalar(data.anno)}`)
  if (data.km !== undefined && data.km !== null) lines.push(`km: ${yamlScalar(data.km)}`)
  if (data.cilindrata !== undefined && data.cilindrata !== null)
    lines.push(`cilindrata: ${yamlScalar(data.cilindrata)}`)
  if (data.prezzo !== undefined && data.prezzo !== null) lines.push(`prezzo: ${yamlScalar(data.prezzo)}`)
  if (data.descrizione !== undefined && data.descrizione !== null && data.descrizione !== '')
    lines.push(`descrizione: ${yamlScalar(data.descrizione)}`)
  lines.push(`venduta: ${data.venduta ? 'true' : 'false'}`)
  if (Array.isArray(data.foto) && data.foto.length > 0) {
    lines.push('foto:')
    for (const f of data.foto) lines.push(`  - ${yamlScalar(f)}`)
  } else {
    lines.push('foto: []')
  }
  return lines.join('\n') + '\n'
}

function unquote(raw) {
  const s = raw.trim()
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s
}

// Parser per il sottoinsieme di YAML usato in moto/<slug>/info.yaml (chiave: valore
// scalare, più un'unica lista `foto:`). Non è un parser YAML generico.
export function parseInfoYaml(text) {
  const out = { foto: [] }
  const lines = text.split(/\r?\n/)
  let inFoto = false
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    if (/^\s*-\s+/.test(rawLine) && inFoto) {
      out.foto.push(unquote(rawLine.replace(/^\s*-\s+/, '')))
      continue
    }
    const m = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if (key === 'foto') {
      inFoto = true
      if (val.trim() === '[]' || val.trim() === '') continue
      // foto: [a, b] inline, raro ma gestito
      const inline = val.trim()
      if (inline.startsWith('[') && inline.endsWith(']')) {
        out.foto = inline
          .slice(1, -1)
          .split(',')
          .map((s) => unquote(s))
          .filter(Boolean)
      }
      continue
    }
    inFoto = false
    if (['anno', 'km', 'cilindrata', 'prezzo'].includes(key)) {
      const n = Number(val.trim())
      out[key] = Number.isFinite(n) ? n : undefined
    } else if (key === 'venduta') {
      out[key] = unquote(val).trim().toLowerCase() === 'true'
    } else {
      out[key] = unquote(val)
    }
  }
  return out
}

// ---- validazione ----

const SLUG_RE = /^[a-z0-9-]+$/
const PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp)$/i
const ALLOWED_PHOTO_TYPES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
}

export function slugify(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function validateMotoData(data) {
  if (!data || typeof data !== 'object') return 'data mancante'
  if (typeof data.marca !== 'string' || !data.marca.trim()) return 'marca mancante'
  if (typeof data.modello !== 'string' || !data.modello.trim()) return 'modello mancante'
  if (!Number.isInteger(data.anno)) return 'anno deve essere un intero'
  if (data.km !== undefined && data.km !== null && (!Number.isInteger(data.km) || data.km < 0))
    return 'km deve essere un intero non negativo'
  if (
    data.cilindrata !== undefined &&
    data.cilindrata !== null &&
    (!Number.isInteger(data.cilindrata) || data.cilindrata <= 0)
  )
    return 'cilindrata deve essere un intero positivo'
  if (data.prezzo !== undefined && data.prezzo !== null && (typeof data.prezzo !== 'number' || data.prezzo <= 0))
    return 'prezzo deve essere un numero positivo'
  if (data.descrizione !== undefined && data.descrizione !== null && typeof data.descrizione !== 'string')
    return 'descrizione deve essere una stringa'
  if (data.venduta !== undefined && typeof data.venduta !== 'boolean') return 'venduta deve essere booleano'
  return null
}

export function detectImageFormat(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp'
  return null
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

  const moto = []
  for (const [slug, bucket] of bySlug) {
    if (!bucket.info) continue
    const yamlText = await getBlobContent(bucket.info.sha)
    const fields = parseInfoYaml(yamlText)
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
  return json(200, { sha: blob.sha, format })
}

async function resolveExistingPhotoSha(tree, slug, name) {
  const path = `moto/${slug}/${name}`
  const entry = tree.find((e) => e.type === 'blob' && e.path === path)
  return entry ? entry.sha : null
}

async function handlePutMoto(slug, payload, event) {
  if (!SLUG_RE.test(slug)) return badRequest('slug non valido nell\'URL')
  if (!payload || typeof payload !== 'object') return badRequest('body JSON mancante')
  const { headSha, data, photos, previousSlug } = payload

  if (typeof headSha !== 'string' || !headSha) return badRequest('headSha mancante')
  const dataErr = validateMotoData(data)
  if (dataErr) return badRequest(`data non valido: ${dataErr}`)

  const expectedSlug = slugify(`${data.marca}-${data.modello}`)
  if (expectedSlug !== slug) return badRequest(`slug non corrisponde a marca/modello (atteso: ${expectedSlug})`)

  if (previousSlug !== undefined && previousSlug !== null) {
    if (typeof previousSlug !== 'string' || !SLUG_RE.test(previousSlug))
      return badRequest('previousSlug non valido')
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

  const isRename = previousSlug && previousSlug !== slug
  const oldSlugForLookup = isRename ? previousSlug : slug

  const entries = []

  // risolvi gli sha delle foto senza sha esplicito (file già esistenti, non ricaricati)
  for (const p of photos) {
    let sha = p.sha
    if (!sha) {
      sha = await resolveExistingPhotoSha(tree, oldSlugForLookup, p.name)
      if (!sha) return badRequest(`foto "${p.name}" senza sha e non trovata nel repo`)
    }
    entries.push({ path: `moto/${slug}/${p.name}`, mode: '100644', type: 'blob', sha })
  }

  // info.yaml nuovo
  const yamlContent = serializeInfoYaml({ ...data, foto: names })
  const infoBlob = await createBlob(Buffer.from(yamlContent, 'utf-8').toString('base64'), 'base64')
  entries.push({ path: `moto/${slug}/info.yaml`, mode: '100644', type: 'blob', sha: infoBlob.sha })

  // rimuovi file non più presenti nella cartella di destinazione/origine
  const keepPaths = new Set(entries.map((e) => e.path))
  const prefix = `moto/${oldSlugForLookup}/`
  for (const e of tree) {
    if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue
    if (isRename) {
      // rinomina: tutto il vecchio percorso va rimosso (i file mantenuti sono già
      // stati riscritti sotto il nuovo slug sopra)
      entries.push({ path: e.path, mode: '100644', type: 'blob', sha: null })
    } else if (!keepPaths.has(e.path)) {
      entries.push({ path: e.path, mode: '100644', type: 'blob', sha: null })
    }
  }

  const newTree = await createTree(commit.tree.sha, entries)
  const message = `cms: aggiorna ${slug} (${userEmail(event)})`
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
  // repo pubblico: lettura anonima per non richiedere lo scope Actions sul PAT
  // (il PAT ha solo permesso Contents).
  const r = await gh(
    `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&per_page=1`,
    { auth: false }
  )
  if (!r.ok) return json(502, { error: 'impossibile leggere lo stato del workflow' })
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
      const slug = decodeURIComponent(motoMatch[1])
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
