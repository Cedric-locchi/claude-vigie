// Aides partagées par le Dashboard et la page Consommation : jours locaux et sommes des lignes de consommation (pures).
import { UsageRow } from './models';

/** Début du jour local (robuste au changement d'heure). */
export const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);
/** `n` jours après `day` (négatif : avant), au début du jour local. */
export const addDays = (day: number, n: number) => { const d = new Date(day); d.setDate(d.getDate() + n); return d.setHours(0, 0, 0, 0); };

export const tokensOf = (r: Pick<UsageRow, 'input' | 'output' | 'cacheCreate' | 'cacheRead'>) => r.input + r.output + r.cacheCreate + r.cacheRead;

/** Totaux d'un lot de lignes, avec les tokens et la part de l'entrée servie par le cache. */
export function sum(rows: UsageRow[]) {
  const t = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 };
  for (const r of rows) { t.input += r.input; t.output += r.output; t.cacheCreate += r.cacheCreate; t.cacheRead += r.cacheRead; t.cost += r.cost; }
  const inputSide = t.input + t.cacheCreate + t.cacheRead;
  return { ...t, tokens: tokensOf(t), cacheRate: inputSide ? t.cacheRead / inputSide : 0 };
}
