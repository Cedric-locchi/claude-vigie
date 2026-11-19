import type { Signal } from '@angular/core';
import { OUTDATED, PluginHost } from '../../../../plugin-sdk/host';
import type { VigieService } from '../../../core/vigie.service';

/** Erreur lisible : message du daemon (`{ error }`), daemon injoignable, réponse hors contrat, sinon `fallback`. */
const reason = (e: unknown, fallback: string): Error => {
  const err = e as { status?: number; error?: { error?: string }; message?: string } | null;
  return new Error(err?.error?.error ?? (err?.status === 0 ? 'Le daemon ne répond pas.' : err?.message === OUTDATED ? OUTDATED : fallback));
};

/** Implémentation de `PluginHost` (décision 037) : le plugin ne voit que ça du cœur de Vigie. */
export function createPluginHost(deps: {
  vigie: Pick<VigieService, 'pluginCall' | 'pluginAction'>;
  sessionId: Signal<string>;
  cwd: Signal<string>;
  pid: Signal<string>;
  /** Terminal ouvert par une action : la page l'affiche. */
  opened: (terminalId: string) => void;
  /** Relit les onglets de plugins de la session. */
  reloadTabs: () => void;
}): PluginHost {
  const { vigie, sessionId, cwd, pid, opened, reloadTabs } = deps;
  return {
    sessionId,
    cwd,
    async call<T>(method: string, params?: unknown, schema?: Parameters<PluginHost['call']>[2], opts?: Parameters<PluginHost['call']>[3]): Promise<T> {
      let v: unknown;
      try {
        v = await vigie.pluginCall(sessionId(), pid(), method, params, opts?.signal);
      } catch (e) {
        // Abandon : la raison du signal telle quelle (AbortError), jamais traduite en « a échoué ».
        if (opts?.signal?.aborted) throw e;
        throw reason(e, `« ${method} » a échoué.`);
      }
      if (!schema) return v as T;
      const r = schema.safeParse(v);
      if (!r.success) throw new Error(OUTDATED);
      return r.data as T;
    },
    async terminal(action, params) {
      try {
        const r = await vigie.pluginAction(sessionId(), pid(), action, params ? { params } : {});
        opened(r.terminal.id);
      } catch (e) {
        throw reason(e, `« ${action} » a échoué.`);
      }
    },
    refresh: reloadTabs,
  };
}
