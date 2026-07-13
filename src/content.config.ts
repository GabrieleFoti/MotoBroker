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
