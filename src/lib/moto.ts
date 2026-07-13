type MotoBase = { data: { venduta: boolean; marca: string; modello: string } };

export function slugMoto(entry: { id: string }): string {
  return entry.id.split('/')[0];
}

export function ordinaMoto<T extends MotoBase>(moto: T[]): T[] {
  return [...moto].sort((a, b) => {
    if (a.data.venduta !== b.data.venduta) return a.data.venduta ? 1 : -1;
    const na = `${a.data.marca} ${a.data.modello}`;
    const nb = `${b.data.marca} ${b.data.modello}`;
    return na.localeCompare(nb, 'it');
  });
}
