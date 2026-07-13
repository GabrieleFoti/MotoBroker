import { describe, expect, it } from 'vitest';
import { formattaKm, formattaPrezzo } from './formatta';
import { linkWhatsApp } from './contatti';

describe('formattaPrezzo', () => {
  it('formatta in euro senza decimali', () => {
    expect(formattaPrezzo(21500)).toBe('21.500 €');
  });
  it('prezzo assente diventa su richiesta', () => {
    expect(formattaPrezzo(undefined)).toBe('Prezzo su richiesta');
  });
});

describe('formattaKm', () => {
  it('formatta con separatore migliaia', () => {
    expect(formattaKm(8500)).toBe('8.500 km');
  });
  it('km assenti danno stringa vuota', () => {
    expect(formattaKm(undefined)).toBe('');
  });
});

describe('linkWhatsApp', () => {
  it('genera link wa.me con messaggio urlencoded', () => {
    expect(linkWhatsApp('Info su Ducati Panigale V4')).toBe(
      'https://wa.me/393286119960?text=Info%20su%20Ducati%20Panigale%20V4'
    );
  });
  it('senza messaggio niente query string', () => {
    expect(linkWhatsApp()).toBe('https://wa.me/393286119960');
  });
});
