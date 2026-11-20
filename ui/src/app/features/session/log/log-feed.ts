import { effect, inject, signal, untracked } from '@angular/core';
import { LogEntry } from '../../../core/models';
import { VigieService, daemonError } from '../../../core/vigie.service';

/**
 * Journal d'une session chargé par morceaux, seul chargeur de l'app (onglet Journal, détail d'un agent) : tout à la première
 * lecture d'une session, puis seulement la suite (depuis la dernière ligne reçue) à chaque nouvelle exécution de `source`
 * (les signaux qu'il lit, l'activité en général). Sans doublon : le rafraîchissement redemande la dernière seconde.
 * `source` rend l'id de la session, ou null (rien à charger). `failure` : repli de `daemonError` (daemon injoignable, session
 * inconnue, réponse hors contrat ont leur propre message). À créer dans un contexte d'injection.
 */
export function logFeed(source: () => string | null, failure: string) {
  const vigie = inject(VigieService);
  const entries = signal<LogEntry[]>([]);
  const loading = signal(false);
  const error = signal<string | null>(null);
  let loadedFor: string | null = null;

  async function load(id: string): Promise<void> {
    const fresh = loadedFor !== id;
    if (fresh) {
      loadedFor = id;
      entries.set([]);
      loading.set(true);
    }
    const since = fresh ? 0 : (entries().at(-1)?.ts ?? 0);
    try {
      const page = await vigie.sessionLog(id, since);
      if (loadedFor !== id) return; // réponse d'une session quittée entre-temps
      error.set(null);
      const known = new Set(entries().map((e) => e.id));
      const added = page.entries.filter((e) => !known.has(e.id));
      if (added.length) entries.update((list) => [...list, ...added].sort((a, b) => a.ts - b.ts));
    } catch (e) {
      if (loadedFor === id) error.set(daemonError(e, failure));
    } finally {
      if (loadedFor === id) loading.set(false);
    }
  }

  // Requête vers le daemon à chaque activité : un effet vers l'extérieur, pas une dérivation d'état.
  effect(() => {
    const id = source();
    if (id) untracked(() => void load(id));
  });

  return { entries: entries.asReadonly(), loading: loading.asReadonly(), error: error.asReadonly() };
}
