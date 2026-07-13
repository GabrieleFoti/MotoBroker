const nf = new Intl.NumberFormat('it-IT', { useGrouping: true });

export function formattaPrezzo(prezzo?: number): string {
  if (prezzo === undefined) return 'Prezzo su richiesta';
  return `${nf.format(prezzo)} €`;
}

export function formattaKm(km?: number): string {
  if (km === undefined) return '';
  return `${nf.format(km)} km`;
}
