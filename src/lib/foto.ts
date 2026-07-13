import type { ImageMetadata } from 'astro';

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
