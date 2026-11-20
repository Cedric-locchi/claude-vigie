import { Signal, linkedSignal } from '@angular/core';

/** Ce qu'il faut d'une ressource (resource, httpResource) pour en garder la valeur. */
interface HasValue<T> { hasValue(): boolean; value(): T | undefined }

/**
 * Dernière valeur de la ressource, gardée pendant un rechargement : pas de clignotement à chaque mise à jour.
 * `key` (l'id de session, en général) : la valeur gardée est oubliée quand la clé change, et vaut null quand la clé est null.
 */
export function keepLast<T>(res: HasValue<T>, key?: () => unknown): Signal<T | null> {
  return linkedSignal<{ key: unknown; value: T | undefined }, T | null>({
    source: () => ({ key: key?.(), value: res.hasValue() ? res.value() : undefined }),
    computation: (s, prev) => {
      if (s.value !== undefined) return s.value;
      if (key && s.key === null) return null;
      return prev && prev.source.key === s.key ? prev.value : null;
    },
  });
}

/**
 * Compteur à passer en `version` d'une ressource pour la relire à certains moments seulement.
 * Part de 0 et augmente de 1 à chaque changement de `source` pour lequel `bumps(nouveau, ancien)` est vrai (par défaut : tous).
 */
export function counter<S>(source: () => S, bumps: (next: S, prev: S) => boolean = () => true): Signal<number> {
  return linkedSignal<S, number>({ source, computation: (s, prev) => (prev ? prev.value + (bumps(s, prev.source) ? 1 : 0) : 0) });
}
