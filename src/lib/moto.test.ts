import { describe, expect, it } from 'vitest';
import { ordinaMoto, slugMoto } from './moto';

describe('slugMoto', () => {
  it('estrae il nome cartella dall\'id della collection', () => {
    expect(slugMoto({ id: 'ducati-panigale-v4/info' })).toBe('ducati-panigale-v4');
  });
});

describe('ordinaMoto', () => {
  const m = (marca: string, modello: string, venduta: boolean) => ({
    data: { marca, modello, venduta },
  });
  it('mette le disponibili prima delle vendute, poi alfabetico', () => {
    const input = [m('Yamaha', 'R1', false), m('Aprilia', 'RS660', true), m('Bmw', 'R1250GS', false)];
    const out = ordinaMoto(input);
    expect(out.map((x) => x.data.marca)).toEqual(['Bmw', 'Yamaha', 'Aprilia']);
  });
  it('non muta l\'array originale', () => {
    const input = [m('Yamaha', 'R1', true), m('Bmw', 'R1250GS', false)];
    const copia = [...input];
    ordinaMoto(input);
    expect(input).toEqual(copia);
  });
});
