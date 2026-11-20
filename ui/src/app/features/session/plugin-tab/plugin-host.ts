import type { Signal } from '@angular/core';
import { type CallOptions, OUTDATED, PluginHost, type ResponseSchema } from '../../../../plugin-sdk/host';
import { type VigieService, daemonError } from '../../../core/vigie.service';

/** Erreur lisible pour le plugin : message du daemon (`{ error }`), daemon injoignable, réponse hors contrat, sinon `fallback`. */
const reason = (e: unknown, fallback: string): Error => new Error(daemonError(e, fallback));

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
    async call<T>(method: string, params: unknown, schema: ResponseSchema<T>, opts?: CallOptions): Promise<T> {
      let v: unknown;
      try {
        v = await vigie.pluginCall(sessionId(), pid(), method, params, opts?.signal);
      } catch (e) {
        // Abandon : la raison du signal telle quelle (AbortError), jamais traduite en « a échoué ».
        if (opts?.signal?.aborted) throw e;
        throw reason(e, `« ${method} » a échoué.`);
      }
      const r = schema.safeParse(v);
      if (!r.success) throw new Error(OUTDATED);
      return r.data;
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
