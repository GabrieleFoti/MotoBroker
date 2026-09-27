import type { ImageMetadata } from 'astro';

const tutte = import.meta.glob<{ default: ImageMetadata }>(
  '/moto/**/*.{jpg,jpeg,png,webp}',
  { eager: true }
);

/** Prima le foto in `ordine` (come scelto nel CMS), poi le altre in ordine alfabetico. */
export function ordinaFoto(nomi: string[], ordine: string[]): string[] {
  const scelte = ordine.filter((n) => nomi.includes(n));
  const resto = nomi.filter((n) => !scelte.includes(n)).sort();
  return [...scelte, ...resto];
}

export function fotoMoto(slug: string, ordine: string[] = []): ImageMetadata[] {
  const base = `/moto/${slug}/`;
  const nomi = Object.keys(tutte)
    .filter((path) => path.startsWith(base))
    .map((path) => path.slice(base.length));
  return ordinaFoto(nomi, ordine).map((nome) => tutte[base + nome].default);
}
