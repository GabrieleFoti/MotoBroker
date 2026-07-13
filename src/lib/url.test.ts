import { afterEach, describe, expect, it, vi } from 'vitest';
import { url } from './url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('url', () => {
  it('prefissa il base path di GitHub Pages togliendo lo slash finale', () => {
    vi.stubEnv('BASE_URL', '/MotoBroker/');
    expect(url('/moto/')).toBe('/MotoBroker/moto/');
  });

  it('gestisce base senza slash finale', () => {
    vi.stubEnv('BASE_URL', '/MotoBroker');
    expect(url('/moto/')).toBe('/MotoBroker/moto/');
  });

  it('con base root restituisce il path invariato', () => {
    vi.stubEnv('BASE_URL', '/');
    expect(url('/moto/')).toBe('/moto/');
  });
});
