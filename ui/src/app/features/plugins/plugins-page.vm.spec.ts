import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import { VigieService } from '../../core/vigie.service';
import { provideVigieServiceMock, somePlugins } from '../../core/vigie.service.mock';
import { PluginsPageVm } from './plugins-page.vm';

function createVm(togglePlugin?: VigieService['togglePlugin']) {
  TestBed.configureTestingModule({ providers: [PluginsPageVm, provideVigieServiceMock(togglePlugin ? { togglePlugin } : {})] });
  const vm = TestBed.inject(PluginsPageVm);
  return { vm, vigie: TestBed.inject(VigieService) };
}

describe('PluginsPageVm', () => {
  it('un clic active un plugin désactivé, un second le désactive ; la carte suit la réponse du daemon', async () => {
    const { vm, vigie } = createVm();
    const xcode = somePlugins()[1];
    await vm.toggle(xcode);
    expect(vigie.togglePlugin).toHaveBeenCalledWith('xcode', true);
    expect(vm.resource.value()?.find((p) => p.id === 'xcode')?.enabled).toBe(true);
    await vm.toggle(vm.resource.value()!.find((p) => p.id === 'xcode')!);
    expect(vigie.togglePlugin).toHaveBeenLastCalledWith('xcode', false);
    expect(vm.busy()).toBeNull();
  });

  it('un échec s’affiche sur la carte et relit la liste (erreur de chargement du plugin)', async () => {
    const toggle = vi.fn(async () => { throw new HttpErrorResponse({ status: 400, error: { error: 'API de plugin non supportée (2)' } }); });
    const { vm } = createVm(toggle);
    await vm.toggle(somePlugins()[2]);
    expect(vm.failure()).toEqual({ id: 'gradle', message: 'API de plugin non supportée (2)' });
    expect(vm.resource.reload).toHaveBeenCalled();
  });

  it('une bascule à la fois', async () => {
    let resolve!: (v: ReturnType<typeof somePlugins>[number]) => void;
    const toggle = vi.fn(() => new Promise<ReturnType<typeof somePlugins>[number]>((r) => (resolve = r)));
    const { vm } = createVm(toggle);
    const p = vm.toggle(somePlugins()[0]);
    expect(vm.busy()).toBe('mise');
    await vm.toggle(somePlugins()[1]);
    expect(toggle).toHaveBeenCalledTimes(1);
    resolve({ ...somePlugins()[0], enabled: false });
    await p;
    expect(vm.resource.value()?.[0].enabled).toBe(false);
  });
});
