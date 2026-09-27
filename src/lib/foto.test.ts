import { describe, expect, it } from 'vitest';
import { ordinaFoto } from './foto';

describe('ordinaFoto', () => {
  it('rispetta l\'ordine del CMS e accoda le altre in alfabetico', () => {
    expect(ordinaFoto(['c.jpg', 'a.jpg', 'b.jpg'], ['b.jpg'])).toEqual(['b.jpg', 'a.jpg', 'c.jpg']);
  });
  it('ignora nomi in ordine che non esistono piu\' nella cartella', () => {
    expect(ordinaFoto(['a.jpg'], ['x.jpg', 'a.jpg'])).toEqual(['a.jpg']);
  });
  it('senza ordine e\' alfabetico', () => {
    expect(ordinaFoto(['02.jpg', '01.jpg'], [])).toEqual(['01.jpg', '02.jpg']);
  });
});
