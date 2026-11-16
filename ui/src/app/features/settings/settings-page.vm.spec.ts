import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { aSettings, fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { VigieService } from '../../core/vigie.service';
import { SettingsPageVm } from './settings-page.vm';

function createVm(saveSettings = vi.fn(async () => aSettings())) {
  TestBed.configureTestingModule({
    providers: [SettingsPageVm, provideRouter([]), provideVigieServiceMock({
      settingsResource: (() => fakeResource(aSettings({ alerts: { dailyCost: 20, windowPct: 0.8 } }))) as unknown as VigieService['settingsResource'],
      saveSettings,
    })],
  });
  return { vm: TestBed.inject(SettingsPageVm), saveSettings };
}

describe('SettingsPageVm', () => {
  it('reprend les seuils du daemon (fenêtre en %)', () => {
    expect(createVm().vm.alertsModel()).toEqual({ dailyCost: '20', windowPct: '80' });
  });

  it('enregistre les seuils (virgule acceptée, % → fraction, vide = désactivé)', async () => {
    const { vm, saveSettings } = createVm();
    vm.alertsModel.set({ dailyCost: '12,5', windowPct: '' });
    await vm.saveAlerts();
    expect(saveSettings).toHaveBeenCalledWith({ alerts: { dailyCost: 12.5, windowPct: null } });
    expect(vm.alertsSaved()).toBe(true);
    vm.alertsModel.set({ dailyCost: '', windowPct: '90' });
    await vm.saveAlerts();
    expect(saveSettings).toHaveBeenLastCalledWith({ alerts: { dailyCost: null, windowPct: 0.9 } });
  });

  it('affiche les erreurs du schéma du contrat et n’envoie rien', async () => {
    const { vm, saveSettings } = createVm();
    vm.alertsModel.set({ dailyCost: 'abc', windowPct: '150' });
    await vm.saveAlerts();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(vm.alertsForm.dailyCost().errors()[0]?.message).toBe('Le seuil de coût doit être un nombre');
    expect(vm.alertsForm.windowPct().errors()[0]?.message).toBe('Entre 1 et 100 %');
    vm.alertsModel.set({ dailyCost: '-3', windowPct: '' });
    expect(vm.alertsForm.dailyCost().errors()[0]?.message).toBe('Le seuil de coût doit être positif');
  });

  it('relaie le refus du daemon', async () => {
    const { vm } = createVm(vi.fn(async () => { throw new HttpErrorResponse({ status: 400, error: { error: 'Seuils d’alerte invalides' } }); }));
    await vm.saveAlerts();
    expect(vm.alertsError()).toBe('Seuils d’alerte invalides');
    expect(vm.alertsSaved()).toBe(false);
  });

  it('enregistre la locale (vide : automatique)', async () => {
    const { vm, saveSettings } = createVm();
    await vm.saveLocale('  ');
    expect(saveSettings).toHaveBeenCalledWith({ locale: null });
  });
});
