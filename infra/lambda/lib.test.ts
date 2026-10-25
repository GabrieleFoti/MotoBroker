import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
// js-yaml 4: load() è sicuro di default (nessun tag eseguibile); legge solo file del repo.
import yaml from 'js-yaml';
import {
  serializeInfoYaml,
  parseInfoYaml,
  slugify,
  detectImageFormat,
  blobReceipt,
  checkReceipt,
  validateMotoData,
  unknownFields,
} from './lib.mjs';

const slugs = readdirSync('moto', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((s) => {
    try {
      readFileSync(`moto/${s}/info.yaml`);
      return true;
    } catch {
      return false;
    }
  });

describe('info.yaml: lettura e riscrittura dei file reali', () => {
  it('ci sono moto da controllare', () => expect(slugs.length).toBeGreaterThan(0));

  for (const slug of slugs) {
    const text = readFileSync(`moto/${slug}/info.yaml`, 'utf-8');

    it(`${slug}: lettura identica a js-yaml (il parser di Astro)`, () => {
      const atteso = yaml.load(text) as Record<string, unknown>;
      const letto = parseInfoYaml(text);
      for (const k of ['marca', 'modello', 'anno', 'km', 'cilindrata', 'prezzo', 'descrizione']) {
        expect(letto[k], k).toEqual(atteso[k] ?? undefined);
      }
      expect(letto.venduta).toBe(atteso.venduta === true);
      expect(letto.foto).toEqual(atteso.foto ?? []);
    });

    it(`${slug}: salvare senza modifiche non perde nulla`, () => {
      const letto = parseInfoYaml(text);
      const riscritto = serializeInfoYaml(letto);
      expect(yaml.load(riscritto)).toEqual(
        Object.fromEntries(
          Object.entries({ ...(yaml.load(text) as object), venduta: letto.venduta }).filter(
            ([, v]) => v !== null && v !== undefined
          )
        )
      );
    });
  }

  it('la descrizione multilinea della Ducati Monster sopravvive a un cambio di "venduta"', () => {
    const text = readFileSync('moto/ducati-monster/info.yaml', 'utf-8');
    const prima = parseInfoYaml(text);
    expect(prima.descrizione).toContain('DOPPIO DISCO anteriore');
    expect(prima.descrizione).not.toBe('|');
    const dopo = parseInfoYaml(serializeInfoYaml({ ...prima, venduta: true }));
    expect(dopo.descrizione).toBe(prima.descrizione);
    expect(dopo.venduta).toBe(true);
  });
});

describe('serializeInfoYaml: casi limite del pannello', () => {
  const base = { marca: 'DUCATI', modello: 'Monster', anno: 2000, venduta: false, foto: ['a.jpg'] };
  const giro = (descrizione: string) =>
    parseInfoYaml(serializeInfoYaml({ ...base, descrizione })).descrizione;

  it.each([
    ['testo con a capo', 'riga 1\nriga 2\n\nriga 4'],
    ['a capo finale', 'riga 1\nriga 2\n'],
    ['più a capo finali', 'riga 1\n\n\n'],
    ['prima riga indentata', '  indentata\npoi normale'],
    ['riga che inizia con #', 'testo\n# non è un commento'],
    ['" #" in una riga', 'prezzo 100 # trattabile'],
    ['due punti', 'Nota: finanziabile'],
    ['virgolette e backslash', 'dice "ciao" e \\ basta'],
    ['tab', 'colonna\tcolonna'],
    ['spazi finali su una riga', 'riga con spazi   \naltra'],
    ['emoji e accenti', 'CITTÀ 🏍️ perché'],
    ['solo spazio iniziale', ' inizia con spazio'],
    ['sembra un numero', '1590'],
    ['sembra un booleano', 'true'],
    ['CRLF dal textarea', 'riga 1\r\nriga 2'],
  ])('%s', (_, d) => {
    expect(giro(d)).toBe(d.replace(/\r\n?/g, '\n'));
  });

  it('marca con spazio finale (come "BMW ") resta tra virgolette', () => {
    const out = serializeInfoYaml({ ...base, marca: 'BMW ' });
    expect(out).toContain('marca: "BMW "');
    expect(parseInfoYaml(out).marca).toBe('BMW ');
  });

  it('un campo sconosciuto blocca la scrittura invece di sparire', () => {
    expect(() => serializeInfoYaml({ ...base, colore: 'rosso' })).toThrow(/colore/);
  });

  it('nessun info.yaml del repo ha campi che il pannello perderebbe', () => {
    for (const slug of slugs) {
      expect(unknownFields(parseInfoYaml(readFileSync(`moto/${slug}/info.yaml`, 'utf-8'))), slug).toEqual([]);
    }
  });

  it('il file prodotto è sempre YAML valido per js-yaml', () => {
    const out = serializeInfoYaml({ ...base, descrizione: 'a\n  b\n#c\n- d: e' });
    expect(() => yaml.load(out)).not.toThrow();
  });
});

describe('slug, validazione, immagini, ricevute', () => {
  it('slugify come Decap', () => {
    expect(slugify('DUCATI-Monster 600 - A2')).toBe('ducati-monster-600-a2');
    expect(slugify('Città-Èlite')).toBe('citta-elite');
  });

  it('validateMotoData', () => {
    expect(validateMotoData({ marca: 'a', modello: 'b', anno: 2000 })).toBeNull();
    expect(validateMotoData({ marca: 'a', modello: 'b', anno: 2000.5 })).toMatch(/anno/);
  });

  it('detectImageFormat', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0]))).toBe('jpeg');
    expect(detectImageFormat(Buffer.from('GIF89a'))).toBeNull();
  });

  it('ricevuta valida solo per lo sha e la chiave giusti', () => {
    const sha = 'a'.repeat(40);
    const r = blobReceipt(sha, 'chiave');
    expect(checkReceipt(sha, r, 'chiave')).toBe(true);
    expect(checkReceipt('b'.repeat(40), r, 'chiave')).toBe(false);
    expect(checkReceipt(sha, r, 'altra')).toBe(false);
    expect(checkReceipt(sha, undefined, 'chiave')).toBe(false);
  });
});
