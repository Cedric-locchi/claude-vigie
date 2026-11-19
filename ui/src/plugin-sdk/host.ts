import type { Signal } from '@angular/core';

/**
 * SDK front des plugins (décision 037), partie hôte : le seul pont entre le composant d'un plugin et Vigie.
 * Un plugin n'importe jamais `ui/src/app/**` (règle ESLint). Le composant exporté par défaut de `plugins/<id>/ui/index.ts`
 * reçoit l'input `sessionId` et injecte `PluginHost`.
 */

/** Réponse hors contrat (JSON qui ne passe pas le schéma) : daemon d'une autre version. */
export const OUTDATED = 'Réponse inattendue du daemon : est-il à jour ? (redémarre-le après une mise à jour)';

/** Ce que `call` attend d'un schéma : un `safeParse` (zod, ou tout schéma qui en a un). */
export interface ResponseSchema<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}

/** Options d'un appel : `signal` l'abandonne (onglet quitté, Rafraîchir). */
export interface CallOptions {
  signal?: AbortSignal;
}

/** Service injecté dans le composant d'un plugin (le jeton DI est cette classe abstraite). */
export abstract class PluginHost {
  /** Id de la session et dossier du projet. */
  abstract readonly sessionId: Signal<string>;
  abstract readonly cwd: Signal<string>;
  /**
   * Appelle une méthode du backend du plugin. Avec `schema`, la réponse est validée (échec → Error(OUTDATED)).
   * Rejette avec Error(message du daemon) sur 4xx/5xx. `opts.signal` abandonne la requête HTTP (dans un `resource`,
   * passer l'`abortSignal` du loader) : la promesse rejette alors avec `signal.reason` (AbortError), pas un message.
   */
  abstract call<T = unknown>(method: string, params?: unknown, schema?: ResponseSchema<T>, opts?: CallOptions): Promise<T>;
  /** Lance une action terminal du plugin ; la page affiche le terminal ouvert. Rejette avec le message du daemon. */
  abstract terminal(action: string, params?: Record<string, string | number | boolean | null>): Promise<void>;
  /** Relit les onglets de plugins de la session (détection + badge), par exemple après `mise trust`. */
  abstract refresh(): void;
}
