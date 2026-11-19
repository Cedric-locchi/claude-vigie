import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/mini';
import { OUTDATED } from '@vigie/plugin-sdk';
import { aTerminal } from '../../../core/vigie.service.mock';
import { createPluginHost } from './plugin-host';

const setup = (vigie: Partial<Parameters<typeof createPluginHost>[0]['vigie']> = {}) => {
  const deps = {
    vigie: { pluginCall: vi.fn(async () => ({ n: 1 })), pluginAction: vi.fn(async () => ({ terminal: aTerminal({ id: 't7' }) })), ...vigie },
    sessionId: signal('s1'), cwd: signal('/dev/app'), pid: signal('mise'), opened: vi.fn(), reloadTabs: vi.fn(),
  };
  return { deps, host: createPluginHost(deps) };
};

describe('createPluginHost', () => {
  it('call : session et plugin courants, réponse validée par le schéma du plugin', async () => {
    const { deps, host } = setup();
    await expect(host.call('tasks', { all: true }, z.object({ n: z.number() }))).resolves.toEqual({ n: 1 });
    expect(deps.vigie.pluginCall).toHaveBeenCalledWith('s1', 'mise', 'tasks', { all: true }, undefined);
    await expect(host.call('tasks', undefined, z.object({ n: z.string() }))).rejects.toThrow(OUTDATED);
    await expect(host.call('tasks')).resolves.toEqual({ n: 1 }); // sans schéma : tel quel
  });

  it('erreur du daemon → son message ; daemon injoignable → message lisible', async () => {
    const { host } = setup({ pluginCall: vi.fn(async () => { throw new HttpErrorResponse({ status: 404, error: { error: 'Méthode inconnue' } }); }) });
    await expect(host.call('nope')).rejects.toThrow('Méthode inconnue');
    const down = setup({ pluginAction: vi.fn(async () => { throw new HttpErrorResponse({ status: 0 }); }) });
    await expect(down.host.terminal('run')).rejects.toThrow('Le daemon ne répond pas.');
    expect(down.deps.opened).not.toHaveBeenCalled();
  });

  it('call abandonné : signal transmis, rejet avec la raison du signal (AbortError), jamais « a échoué »', async () => {
    const ctrl = new AbortController();
    const { deps, host } = setup({ pluginCall: vi.fn((...a: unknown[]) => new Promise((_, reject) => (a[4] as AbortSignal).addEventListener('abort', () => reject(new Error('annulée'))))) });
    const p = host.call('graph', {}, undefined, { signal: ctrl.signal });
    expect(deps.vigie.pluginCall).toHaveBeenCalledWith('s1', 'mise', 'graph', {}, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toThrow('annulée');
  });

  it('terminal : params envoyés tels quels, terminal ouvert affiché ; refresh relit les onglets', async () => {
    const { deps, host } = setup();
    await host.terminal('run', { task: 'test' });
    expect(deps.vigie.pluginAction).toHaveBeenCalledWith('s1', 'mise', 'run', { params: { task: 'test' } });
    expect(deps.opened).toHaveBeenCalledWith('t7');
    await host.terminal('trust');
    expect(deps.vigie.pluginAction).toHaveBeenLastCalledWith('s1', 'mise', 'trust', {});
    host.refresh();
    expect(deps.reloadTabs).toHaveBeenCalled();
  });
});
