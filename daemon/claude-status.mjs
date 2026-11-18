// Statut de Claude (status.claude.com, décision 024) : seul module du daemon qui sort de la machine.
// Un GET en dur, sans cookie ni corps ; la réponse n'est pas fiable, on n'en garde qu'une forme bornée.
import httpModule from 'node:http';

export const STATUS_URL = 'https://status.claude.com/api/v2/summary.json';
export const STATUS_PAGE = 'https://status.claude.com';

const INDICATORS = new Set(['none', 'minor', 'major', 'critical', 'maintenance']);
const LINK_HOSTS = new Set(['status.claude.com', 'stspg.io']);

// Un lien d'incident ne peut mener qu'à la page de statut (https, hôte connu) : il finit dans un <a> de l'UI.
function safeLink(s) {
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' && LINK_HOSTS.has(u.hostname)) return u.href;
  } catch { /* URL invalide : repli */ }
  return STATUS_PAGE;
}

/** Pur : JSON quelconque → { indicator, incidents: [{ name, url }] }. Ne lève jamais. */
export function parseStatus(json) {
  if (!json || typeof json !== 'object') return { indicator: 'unknown', incidents: [] };
  const ind = json.status?.indicator;
  const indicator = INDICATORS.has(ind) ? ind : 'unknown';
  const incidents = (Array.isArray(json.incidents) ? json.incidents : [])
    .filter((i) => i && typeof i.name === 'string')
    .slice(0, 5)
    .map((i) => ({ name: i.name.slice(0, 200), url: safeLink(i.shortlink) }));
  return { indicator, incidents };
}

// Le fetch de Node ignore HTTPS_PROXY (derrière un proxy d'entreprise, le statut restait « unknown ») :
// on active le support proxy intégré, une seule fois, et seulement si l'environnement en déclare un. NO_PROXY reste honoré.
// `http` et `env` injectés pour les tests (aucun réseau).
let proxyDone = false;
export function enableEnvProxy(env = process.env, http) {
  if (proxyDone) return false;
  if (!(env.HTTPS_PROXY || env.https_proxy) || typeof http?.setGlobalProxyFromEnv !== 'function') return false;
  proxyDone = true;
  http.setGlobalProxyFromEnv(env);
  return true;
}

/** Ne rejette jamais : erreur, HTTP ≠ 2xx, timeout → parseStatus(null). */
export async function fetchStatus(url = STATUS_URL) {
  try {
    enableEnvProxy(process.env, httpModule);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { accept: 'application/json' } });
    if (!res.ok) return parseStatus(null);
    // ponytail: res.json() n'est pas borné en taille ; lire le corps avec une limite si l'API grossit.
    // ponytail: proxy lu dans l'environnement du daemon seulement ; lancé par launchd, systemd ou le Finder, il n'a pas HTTPS_PROXY
    // (la suite : le relever au `vigie install`).
    return parseStatus(await res.json());
  } catch {
    return parseStatus(null);
  }
}
