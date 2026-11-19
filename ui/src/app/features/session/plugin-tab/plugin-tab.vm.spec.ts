import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PluginHost } from '@vigie/plugin-sdk';
import { provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { PLUGIN_UI_TABLE, PluginTabVm } from './plugin-tab.vm';

@Component({ template: '' })
class FakeUi {}

const setup = (table: Record<string, () => Promise<{ default: typeof FakeUi }>>, pid = 'mise') => {
  TestBed.configureTestingModule({ providers: [provideVigieServiceMock(), PluginTabVm, { provide: PLUGIN_UI_TABLE, useValue: table }] });
  const vm = TestBed.inject(PluginTabVm);
  const src = { id: signal('s1'), cwd: signal('/dev/app'), pid: signal(pid), opened: vi.fn(), refresh: vi.fn() };
  vm.connect(src);
  return { vm, src };
};

describe('PluginTabVm', () => {
  it('charge le composant du plugin et lui fournit un PluginHost de la session', async () => {
    const { vm, src } = setup({ mise: async () => ({ default: FakeUi }) });
    await vi.waitFor(() => expect(vm.ui.value()).toBe(FakeUi));
    expect(vm.missing()).toBe(false);
    expect(vm.inputs()).toEqual({ sessionId: 's1' });
    const host = vm.injector()!.get(PluginHost);
    expect(host.sessionId()).toBe('s1');
    expect(host.cwd()).toBe('/dev/app');
    host.refresh();
    expect(src.refresh).toHaveBeenCalled();
  });

  it('plugin sans front (ou nom hérité d’Object) : « pas d’interface », sans erreur', async () => {
    for (const pid of ['xcode', 'constructor']) {
      TestBed.resetTestingModule();
      const { vm } = setup({ mise: async () => ({ default: FakeUi }) }, pid);
      await vi.waitFor(() => expect(vm.missing()).toBe(true));
      expect(vm.ui.error()).toBeUndefined();
    }
  });

  it('import en échec : erreur, puis Réessayer recharge', async () => {
    let fail = true;
    const { vm } = setup({ mise: async () => { if (fail) throw new Error('chunk introuvable'); return { default: FakeUi }; } });
    await vi.waitFor(() => expect(vm.ui.error()).toBeDefined());
    fail = false;
    vm.retry();
    await vi.waitFor(() => expect(vm.ui.value()).toBe(FakeUi));
  });
});
