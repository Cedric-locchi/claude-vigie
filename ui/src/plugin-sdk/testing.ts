import { signal } from '@angular/core';
import { vi } from 'vitest';
import { OUTDATED, PluginHost, type CallOptions, type ResponseSchema } from './host';

/** Faux `PluginHost` pour les specs des plugins : méthodes en `vi.fn`, remplaçables par `overrides`. */
export function fakePluginHost(overrides: Partial<PluginHost> = {}): PluginHost {
  return {
    sessionId: signal('s1'),
    cwd: signal('/dev/app'),
    call: vi.fn(async () => null),
    terminal: vi.fn(async () => undefined),
    refresh: vi.fn(),
    ...overrides,
  } as PluginHost;
}

/**
 * `call` factice qui répond par méthode et valide avec le schéma comme le vrai host (échec → Error(OUTDATED)) :
 * une réponse factice hors contrat fait échouer le spec. Une valeur `Error` est rejetée ; une `Promise` reste en attente.
 */
export function callReplies(replies: Record<string, unknown>): PluginHost['call'] {
  return vi.fn(async (method: string, _params?: unknown, schema?: ResponseSchema<unknown>, opts?: CallOptions) => {
    if (!Object.hasOwn(replies, method)) throw new Error(`Méthode inconnue : ${method}`);
    const signal = opts?.signal;
    signal?.throwIfAborted();
    // Comme le vrai host : un abandon rejette aussitôt avec `signal.reason`, même si la réponse est en attente.
    const v = await (signal
      ? new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); Promise.resolve(replies[method]).then(resolve, reject); })
      : replies[method]);
    if (v instanceof Error) throw v;
    if (!schema) return v;
    const r = schema.safeParse(v);
    if (!r.success) throw new Error(OUTDATED);
    return r.data;
  }) as PluginHost['call'];
}
