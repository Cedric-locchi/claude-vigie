import { signal } from '@angular/core';

/** Message d'un échec rendu par le host (déjà lisible : message du daemon, OUTDATED…), sinon `fallback`. */
export function errorMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' && m ? m : fallback;
}

/**
 * Lancements d'un onglet de plugin, un à la fois (tâche dans un terminal, `mise trust`, ouverture d'Xcode…) : `launching` porte
 * l'id en cours (boutons inactifs le temps de la requête), `error` le dernier échec. À créer dans le VM du plugin.
 */
export function launcher() {
  const launching = signal<string | null>(null);
  const error = signal<string | null>(null);
  return {
    launching: launching.asReadonly(),
    error: error.asReadonly(),
    /** Ignoré si un lancement est en cours ; un échec devient `error` (message du host, sinon `fallback`). */
    async run(id: string, fn: () => Promise<unknown>, fallback: string): Promise<void> {
      if (launching() !== null) return;
      launching.set(id);
      error.set(null);
      try {
        await fn();
      } catch (e) {
        error.set(errorMessage(e, fallback));
      } finally {
        launching.set(null);
      }
    },
  };
}
