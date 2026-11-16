import * as C from '@vigie/contract';
import { aConfig, aMiseTasks, aProjectFiles, PROJECTS, aSession, aSessionCost, aSettings, aSnapshot, aTerminal, aUsageRows, anAgent, anUsage, anXcodeProject, anXcodeTargets } from './vigie.service.mock';

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
    expect(() => C.MiseTasks.parse(aMiseTasks())).not.toThrow();
    expect(() => C.XcodeProject.parse(anXcodeProject())).not.toThrow();
    expect(() => C.XcodeTargets.parse(anXcodeTargets())).not.toThrow();
    expect(() => C.Agent.parse(anAgent())).not.toThrow();
    expect(() => C.UsageRows.parse(aUsageRows())).not.toThrow();
    expect(() => C.Settings.parse(aSettings({ alerts: { dailyCost: 20, windowPct: 0.8 } }))).not.toThrow();
    expect(() => C.SessionCost.parse(aSessionCost())).not.toThrow();
    expect(() => C.Projects.parse(PROJECTS)).not.toThrow();
  });
});
