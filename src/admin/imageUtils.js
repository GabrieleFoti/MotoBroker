// Ridimensionamento immagini nel browser prima dell'upload: lato lungo max ~2400px,
// JPEG qualità ~0.85 (Astro ottimizza poi ulteriormente in build con `getImage`).

function loadBitmap(file) {
  return createImageBitmap(file);
}

function fitLongSide(w, h, maxLong) {
  const long = Math.max(w, h);
  if (long <= maxLong) return { w, h };
  const scale = maxLong / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function drawResized(bitmap, targetW, targetH) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(targetW, targetH) : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  return canvas;
}

function canvasToJpegBlob(canvas, quality) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob fallito'))), 'image/jpeg', quality);
  });
}

// Ritorna { blob, w, h } di un JPEG ridimensionato.
export async function processImageFile(file, { maxLong = 2400, quality = 0.85 } = {}) {
  const bitmap = await loadBitmap(file);
  const { width, height } = bitmap;
  const dim = fitLongSide(width, height, maxLong);
  const canvas = drawResized(bitmap, dim.w, dim.h);
  const blob = await canvasToJpegBlob(canvas, quality);
  bitmap.close?.();
  return { blob, w: dim.w, h: dim.h };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(new Error('lettura file fallita'));
    reader.readAsDataURL(blob);
  });
}

// Stesso algoritmo della Lambda (infra/lambda/index.mjs `slugify`): deve combinare
// identicamente, altrimenti la Lambda rifiuta con 400 "slug non corrisponde".
export function slugify(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function slugForMoto(marca, modello) {
  return slugify(`${marca}-${modello}`);
}

let photoCounter = 0;
// Nome file valido per la Lambda (PHOTO_NAME_RE): [a-z0-9][a-z0-9._-]*.(jpe?g|png|webp)
export function nextPhotoName() {
  photoCounter += 1;
  return `foto-${Date.now()}-${photoCounter}.jpg`;
}
