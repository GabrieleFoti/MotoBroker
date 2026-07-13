import { describe, it, expect } from 'vitest';
import { url } from './url';

describe('url() helper', () => {
  it('should define BASE_URL in test environment', () => {
    expect(import.meta.env.BASE_URL).toBeDefined();
    expect(typeof import.meta.env.BASE_URL).toBe('string');
  });

  it('url(\'/moto/\') should return a path ending in /moto/ with no double slashes', () => {
    const result = url('/moto/');
    expect(result).toBe('/moto/');
    expect(result).not.toMatch(/\/\//);
  });

  it('url(\'/\') should return normalized base URL with no double slash', () => {
    const result = url('/');
    // When base is '/' (default), after stripping trailing slash it becomes ''
    // So url('/') returns '' + '/' = '/'
    expect(result).toBe('/');
    expect(result).not.toMatch(/\/\//);
  });

  it('url(\'/page\') should concatenate with normalized base and contain no double slashes', () => {
    const result = url('/page');
    expect(result).toBe('/page');
    expect(result).not.toMatch(/\/\//);
  });

  it('url(\'/api/endpoint\') should build the correct path with no double slashes', () => {
    const result = url('/api/endpoint');
    expect(result).toBe('/api/endpoint');
    expect(result).not.toMatch(/\/\//);
  });
});
