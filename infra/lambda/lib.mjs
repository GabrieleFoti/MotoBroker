// Funzioni pure del CMS (nessuna chiamata di rete): YAML, slug, validazione, formati
// immagine, ricevute dei blob. Separate da index.mjs per poterle testare con `npm test`.
import { createHmac, timingSafeEqual } from 'node:crypto'
// Stesso parser YAML usato da Astro per leggere moto/*/info.yaml in build: quello che il
// pannello legge e scrive è esattamente quello che il sito vede. deploy.sh lo copia nello zip.
import yaml from 'js-yaml'
// js-yaml 4: load() usa di default il DEFAULT_SCHEMA sicuro (nessun tag che esegue codice).

// ---- YAML: stesso stile dei file scritti da Decap, verificato con js-yaml ----

// Scalare su una riga: plain se js-yaml lo rilegge identico, altrimenti double-quoted
// (JSON.stringify produce YAML double-quoted valido).
function yamlScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  if (!/[\u0000-\u001f\u007f]/.test(s) && s === s.trim() && s !== '') {
    try {
      if (yaml.load(`k: ${s}`)?.k === s) return s
    } catch {}
  }
  return JSON.stringify(s)
}

// Testo multilinea: block scalar letterale, come fa Decap (`descrizione: |`).
// Indicatore di chomping in base agli a capo finali, indentazione esplicita se la
// prima riga inizia con uno spazio.
function yamlBlock(key, s) {
  const trailing = s.match(/\n*$/)[0].length
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+'
  const body = trailing ? s.slice(0, -trailing) : s
  const indentInd = /^[ \n]/.test(body) ? '2' : ''
  const lines = body.split('\n').map((l) => (l === '' ? '' : `  ${l}`))
  for (let k = 1; k < trailing; k++) lines.push('')
  return [`${key}: |${indentInd}${chomp}`, ...lines]
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
  const d = data.descrizione
  if (d !== undefined && d !== null && d !== '') {
    const text = String(d).replace(/\r\n?/g, '\n')
    if (text.includes('\n')) lines.push(...yamlBlock('descrizione', text))
    else lines.push(`descrizione: ${yamlScalar(text)}`)
  }
  lines.push(`venduta: ${data.venduta ? 'true' : 'false'}`)
  if (Array.isArray(data.foto) && data.foto.length > 0) {
    lines.push('foto:')
    for (const f of data.foto) lines.push(`  - ${yamlScalar(f)}`)
  } else {
    lines.push('foto: []')
  }
  const out = lines.join('\n') + '\n'
  // Garanzia: il file scritto si rilegge con gli stessi valori, o non si scrive.
  const back = parseInfoYaml(out)
  for (const k of ['marca', 'modello', 'anno', 'km', 'cilindrata', 'prezzo', 'venduta']) {
    const want = k === 'venduta' ? Boolean(data[k]) : data[k] ?? undefined
    if (back[k] !== want) throw new Error(`serializzazione YAML non fedele sul campo ${k}`)
  }
  if ((back.descrizione ?? '') !== (d === undefined || d === null ? '' : String(d).replace(/\r\n?/g, '\n')))
    throw new Error('serializzazione YAML non fedele sul campo descrizione')
  return out
}

// Lettura con js-yaml (lo stesso parser di Astro): gestisce block scalar `|`, `>`, ecc.
export function parseInfoYaml(text) {
  const doc = yaml.load(text) || {}
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new Error('info.yaml non è una mappa')
  const out = { ...doc }
  out.foto = Array.isArray(doc.foto) ? doc.foto.map(String) : []
  for (const k of ['anno', 'km', 'cilindrata', 'prezzo']) {
    if (out[k] === null || out[k] === undefined) delete out[k]
  }
  if (out.descrizione === null) delete out.descrizione
  if (out.descrizione !== undefined) out.descrizione = String(out.descrizione)
  for (const k of ['marca', 'modello']) if (out[k] !== undefined && out[k] !== null) out[k] = String(out[k])
  out.venduta = out.venduta === true
  return out
}

// ---- validazione ----

export const SLUG_RE = /^[a-z0-9-]+$/
export const PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp)$/i

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

// ---- ricevuta dei blob caricati ----
// POST /blobs restituisce, oltre allo sha, una ricevuta HMAC dello sha firmata con il token
// GitHub (segreto lato server). PUT accetta uno sha nuovo solo con la sua ricevuta: così
// come foto può finire solo un'immagine validata da /blobs, non un blob qualunque del repo.
export function blobReceipt(sha, key) {
  return createHmac('sha256', key).update(`motobroker-blob:${sha}`).digest('hex')
}

export function checkReceipt(sha, receipt, key) {
  if (typeof receipt !== 'string' || !/^[0-9a-f]{64}$/.test(receipt)) return false
  const a = Buffer.from(blobReceipt(sha, key), 'hex')
  const b = Buffer.from(receipt, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

