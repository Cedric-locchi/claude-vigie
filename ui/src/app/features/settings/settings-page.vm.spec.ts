import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { throwError } from 'rxjs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { LanguageService } from '../../core/language.service';
import { Settings } from '../../core/models';
import { VigieService } from '../../core/vigie.service';
import { aSettings, fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { SettingsPageVm } from './settings-page.vm';

function createVm(saveSettings?: VigieService['saveSettings']) {
  const settings = fakeResource<Settings | undefined>(aSettings({ alerts: { dailyCost: 20, windowPct: 0.8 } }));
  TestBed.configureTestingModule({
    providers: [SettingsPageVm, provideRouter([]), provideVigieServiceMock({ settingsResource: () => settings, ...(saveSettings ? { saveSettings } : {}) })],
  });
  return { vm: TestBed.inject(SettingsPageVm), saveSettings: vi.mocked(TestBed.inject(VigieService).saveSettings) };
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

  it('enregistrer la locale garde les seuils saisis et pas encore enregistrés', async () => {
    const { vm } = createVm();
    vm.alertsModel.set({ dailyCost: '33', windowPct: '' });
    await vm.saveLocale('fr_FR.UTF-8');
    expect(vm.settings()?.locale).toBe('fr_FR.UTF-8'); // la ressource partagée a changé
    expect(vm.alertsModel()).toEqual({ dailyCost: '33', windowPct: '' });
    await vm.saveAlerts(); // seuils enregistrés : la saisie suit le daemon
    expect(vm.alertsModel()).toEqual({ dailyCost: '33', windowPct: '' });
    expect(vm.settings()?.alerts).toEqual({ dailyCost: 33, windowPct: null });
  });

  it("500 sans corps : le message dit ce qui n'a pas été enregistré, pas « daemon injoignable »", async () => {
    const { vm } = createVm(vi.fn(async () => { throw new HttpErrorResponse({ status: 500, error: null }); }));
    await vm.saveLocale('fr_FR.UTF-8');
    expect(vm.localeError()).toBe('Locale non enregistrée.');
  });

  it('le message de repli suit la langue de l’interface', async () => {
    const htmlLang = document.documentElement.lang;
    onTestFinished(() => { document.documentElement.lang = htmlLang; });
    const { vm } = createVm(vi.fn(async () => { throw new HttpErrorResponse({ status: 500, error: null }); }));
    await TestBed.inject(LanguageService).set('en');
    await vm.saveLocale('fr_FR.UTF-8');
    expect(vm.localeError()).toBe('Locale not saved.');
  });

  it('catalogue introuvable : le groupe de bascule revient sur la langue active', async () => {
    const { vm } = createVm();
    vi.spyOn(TestBed.inject(TranslocoService), 'load').mockReturnValue(throwError(() => new Error('chunk')));
    const switching = vm.setLang('en');
    expect(vm.langChoice()).toBe('en');
    await switching;
    expect(vm.langChoice()).toBe('fr');
  });

  it('daemon injoignable : réglages absents, saisies vides, rien ne lève', () => {
    TestBed.configureTestingModule({
      providers: [SettingsPageVm, provideRouter([]), provideVigieServiceMock({
        settingsResource: () => fakeResource(undefined, 'error', new Error('daemon injoignable')),
      })],
    });
    const vm = TestBed.inject(SettingsPageVm);
    expect(vm.settings()).toBeUndefined();
    expect(vm.locale()).toBe('');
    expect(vm.alertsModel()).toEqual({ dailyCost: '', windowPct: '' });
  });
});
