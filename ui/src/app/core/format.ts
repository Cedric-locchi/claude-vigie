// Formatage d'affichage, en français : « 4,2 M », « 312 k », « 1 h 48 ».
const fr1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function tokens(n: number): string {
  if (n >= 1e9) return `${fr1.format(n / 1e9)} G`;
  if (n >= 1e6) return `${fr1.format(n / 1e6)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(Math.round(n));
}

export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });

/** « 12,34 $ », sans centimes au-delà de 100 $. */
export function usd(n: number): string {
  return (n >= 100 ? usd0 : usd2).format(n);
}

/** Durée d'une étape : « 12 ms », « 1,4 s », puis « 3 min », « 1 h 05 ». */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${fr1.format(ms / 1000)} s`;
  return duration(ms);
}

