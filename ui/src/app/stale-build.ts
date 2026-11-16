import { NavigationError } from '@angular/router';

/** Échec de chargement d'une page à la demande : son fichier n'existe plus (UI reconstruite ou mise à jour pendant que l'app était ouverte). */
export const isStaleChunk = (error: unknown): boolean =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|ChunkLoadError/i.test(String((error as Error)?.message ?? error));

const KEY = 'vigie-stale-reload';

/**
 * Après une mise à jour de l'UI, les pages chargées à la demande ont changé de nom : la navigation échoue sans rien afficher.
 * On recharge la page sur l'adresse visée, une seule fois par 10 s pour ne pas boucler si le daemon est vraiment injoignable.
 */
export function reloadOnStaleChunk(e: NavigationError, win: Window | null = typeof window === 'undefined' ? null : window): boolean {
  return reloadIfStale(e.error, e.url, win);
}

/** Même règle pour un import à la demande hors navigation (ex. la bibliothèque de graphiques). */
export function reloadIfStale(error: unknown, url: string, win: Window | null = typeof window === 'undefined' ? null : window): boolean {
  if (!win || !isStaleChunk(error)) return false;
  try {
    const last = Number(win.sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return false;
    win.sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* stockage bloqué : on recharge quand même, une fois par navigation */ }
  win.location.assign(url);
  return true;
}
