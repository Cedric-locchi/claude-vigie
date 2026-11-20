// Formatage d'affichage, en français : « 4,2 M », « 312 k », « 1 h 48 ».
// ponytail: formats en fr-FR quelle que soit la langue de l'UI (« 4,2 M », « 12,34 $ ») ; ils suivront LanguageService
// (formatters recréés par langue) quand les pages qui les affichent seront traduites.
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

/** Heure à la seconde (« 14:05:09 ») : entrées du journal et du fil d'un agent. */
export function clockSeconds(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

/** Ancienneté : « à l'instant », « il y a 12 min », « il y a 2 h », « il y a 3 j », « il y a 4 mois », « il y a 2 ans ». */
export function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  const y = Math.floor(d / 365);
  return `il y a ${y} an${y > 1 ? 's' : ''}`;
}

/** Texte gardé avant le texte trouvé : au-delà, l'extrait commence par « … » pour que le surlignage reste visible. */
const BEFORE = 40;

/** Extrait de recherche sans l'indentation, coupé avant le texte trouvé s'il est loin ; `hit` : `text.slice(at, at + n)`. */
export function excerpt(text: string, at: number, n: number): { pre: string; hit: string; post: string } {
  const pre = text.slice(0, at).trimStart();
  return { pre: pre.length > BEFORE ? '…' + pre.slice(-BEFORE) : pre, hit: text.slice(at, at + n), post: text.slice(at + n) };
}
