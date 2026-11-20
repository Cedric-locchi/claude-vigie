import * as C from '@vigie/contract';
import { TestBed } from '@angular/core/testing';
import { aConfig, aGitDiff, aProjectFiles, aSessionUsage, fakeResource, aSearchResults, aSessionSearch, PROJECTS, aSession, aSessionCost, aSettings, aSnapshot, aTerminal, aUsageRows, anAgent, anUsage, provideVigieServiceMock, somePlugins } from './vigie.service.mock';
import { VigieService } from './vigie.service';

// Les fabriques de test suivent le contrat : un mock qui diverge du daemon ferait passer des tests à tort.
describe('mocks du daemon', () => {
  it('respectent les schémas du contrat', () => {
    expect(() => C.SessionSummary.parse(aSession())).not.toThrow();
    expect(() => C.SessionSummary.parse(aSession({ state: 'waiting', reason: 'permission', detail: 'Bash' }))).not.toThrow();
    expect(() => C.Usage.parse(anUsage())).not.toThrow();
    expect(() => C.Snapshot.parse(aSnapshot())).not.toThrow();
    expect(() => C.ClaudeConfig.parse(aConfig())).not.toThrow();
    expect(() => C.Terminal.parse(aTerminal())).not.toThrow();
    expect(() => C.ProjectFiles.parse(aProjectFiles())).not.toThrow();
    expect(() => C.Plugins.parse(somePlugins())).not.toThrow();
    expect(() => C.SessionPlugins.parse([{ id: 'mise', name: 'Tâches mise', badge: '1' }])).not.toThrow();
    expect(() => C.PluginActionResult.parse({ terminal: aTerminal() })).not.toThrow();
    expect(() => C.Agent.parse(anAgent())).not.toThrow();
    expect(() => C.SessionUsage.parse(aSessionUsage())).not.toThrow();
    expect(() => C.UsageRows.parse(aUsageRows())).not.toThrow();
    expect(() => C.Settings.parse(aSettings({ alerts: { dailyCost: 20, windowPct: 0.8 } }))).not.toThrow();
    expect(() => C.SessionCost.parse(aSessionCost())).not.toThrow();
    expect(() => C.Projects.parse(PROJECTS)).not.toThrow();
    expect(() => C.SearchResults.parse(aSearchResults({ truncated: true }))).not.toThrow();
    expect(() => C.SessionSearch.parse(aSessionSearch())).not.toThrow();
    expect(() => C.GitDiff.parse(aGitDiff({ files: [{ path: 'a.ts', status: 'M', staged: false, unstaged: true, added: 1, removed: 0, patch: '', truncated: false }] }))).not.toThrow();
  });

  it("fausse ressource : value() lève en état d'erreur, comme Angular", () => {
    const failed = fakeResource(aSettings(), 'error', new Error('daemon injoignable'));
    expect(failed.hasValue()).toBe(false);
    expect(() => failed.value()).toThrow(/daemon injoignable/);
    expect(fakeResource(aSettings()).value()).toEqual(aSettings());
  });

  it('réglages : une seule ressource partagée, mise à jour par saveSettings (comme le vrai service)', async () => {
    TestBed.configureTestingModule({ providers: [provideVigieServiceMock()] });
    const vigie = TestBed.inject(VigieService);
    const res = vigie.settingsResource();
    expect(vigie.settingsResource()).toBe(res);
    await vigie.saveSettings({ locale: 'fr_FR.UTF-8' });
    expect(res.value()).toEqual(aSettings({ locale: 'fr_FR.UTF-8' }));
    await vigie.saveSettings({ alerts: { dailyCost: 10, windowPct: null } });
    expect(res.value()).toEqual(aSettings({ locale: 'fr_FR.UTF-8', alerts: { dailyCost: 10, windowPct: null } })); // champs absents : inchangés
  });
});
