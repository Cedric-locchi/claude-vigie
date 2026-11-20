import { Provider, Signal, computed, isSignal, signal, untracked } from '@angular/core';
import type { HttpResourceRef } from '@angular/common/http';
import { vi } from 'vitest';
import { Agent, ClaudeConfig, GitDiff, PluginInfo, Project, ProjectFiles, SearchResults, SessionCost, SessionSummary, SessionUsage, Settings, SettingsBody, Snapshot, Terminal, Usage, UsageRow, UsageRows } from './models';
import { VigieService } from './vigie.service';

export function aSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1', project: 'meeplebox', cwd: '/dev/meeplebox', branch: 'feat/suggestions', model: 'claude-opus-5-5',
    title: 'Moteur de suggestions', lastText: 'Tests verts.', tool: 'Bash · xcodebuild test', toolPath: null,
    state: 'running', subagents: 2, activeSubagents: 1, tokens: 312_000, cost: 4.2, activity: [0, 0, 1, 3, 2, 0, 0, 0, 4, 5, 2, 1, 0, 3, 6],
    firstTs: 1_000, lastTs: 60_000, terminalId: null, ...overrides,
  };
}

export function anUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    window: { active: true, pct: 0.62, tokens: 1_000_000, start: 0, end: 18_000_000, projectedPct: 0.86, limitAt: null },
    today: { tokens: 4_200_000, cost: 48.5, cacheRate: 0.81 },
    ...overrides,
  };
}

export function aSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { now: 120_000, sessions: [aSession()], usage: anUsage(), terminals: [], claudeStatus: { indicator: 'none', incidents: [] }, plugins: [], ...overrides };
}

export function anAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'main', name: 'Claude', sub: false, description: '', state: 'running', lastAction: null, lastText: '', lastTextTruncated: false,
    tokens: 120_000, toolCount: 4, firstTs: 1_000, lastTs: 60_000, bars: [], cost: 1.8, ...overrides,
  };
}

/** Consommation d'une session (détail) : contexte de l'agent principal sur sa fenêtre de 200 k. */
export function aSessionUsage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return { input: 100, output: 200, cacheCreate: 300, cacheRead: 400, calls: 3, context: 800, contextMax: 200_000, ...overrides };
}

export function anUsageRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    day: new Date(2026, 10, 13).getTime(), sessionId: 's1', title: 'Moteur de suggestions', project: 'meeplebox', model: 'claude-opus-5-5',
    input: 1_000, output: 2_000, cacheCreate: 500, cacheRead: 6_500, cost: 4.2, ...overrides,
  };
}

/** Réponse de GET /api/usage : une ligne, une fenêtre de 5 h au % relevé, une estimée. */
export function aUsageRows(overrides: Partial<UsageRows> = {}): UsageRows {
  const day = new Date(2026, 10, 13).getTime();
  return {
    now: day + 12 * 3_600_000, since: day - 13 * 86_400_000, rows: [anUsageRow()],
    windows: [
      { start: day + 3_600_000, end: day + 6 * 3_600_000, tokens: 900_000, cost: 12, pct: 0.74 },
      { start: day - 20 * 3_600_000, end: day - 15 * 3_600_000, tokens: 400_000, cost: 5, pct: null },
    ],
    ...overrides,
  };
}

export function aSettings(overrides: Partial<Settings> = {}): Settings {
  return { locale: null, defaultLocale: 'en_US.UTF-8', alerts: { dailyCost: null, windowPct: null }, ...overrides };
}

export function aSessionCost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { step: 60_000, points: [{ ts: 60_000, agent: 'main', cost: 0.4, tokens: 30_000 }, { ts: 120_000, agent: 'a1', cost: 0.1, tokens: 8_000 }], ...overrides };
}

export function aTerminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: 't1', sessionId: 's1', kind: 'claude', title: 'claude', cwd: '/dev/meeplebox', shell: '/bin/zsh',
    pid: 4242, cols: 120, rows: 40, exited: false, startedAt: 1_000, ...overrides,
  };
}

/** Réponse de GET /api/sessions/:id/git : dépôt propre sur `main` (fichiers à fournir). */
export function aGitDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  const files = overrides.files ?? [];
  return { cwd: '/dev/meeplebox', repo: true, root: '/dev/meeplebox', branch: 'main', files, total: files.length, ...overrides };
}

export function aProjectFiles(overrides: Partial<ProjectFiles> = {}): ProjectFiles {
  return { root: '/dev/meeplebox', repo: true, files: ['src/a.ts', '.env', 'README.md'], collapsed: ['node_modules'], truncated: false, ...overrides };
}

/** Réponse de GET /api/sessions/:id/files/search?q=export : deux lignes dans un fichier, une dans un autre. */
export function aSearchResults(overrides: Partial<SearchResults> = {}): SearchResults {
  return {
    files: [
      { path: 'src/a.ts', matches: [{ line: 1, col: 1, text: 'export const a = 1;', at: 0 }, { line: 3, col: 3, text: '  export const b = 2;', at: 2 }] },
      { path: 'README.md', matches: [{ line: 2, col: 5, text: 'On export tout.', at: 3 }] },
    ],
    truncated: false,
    ...overrides,
  };
}

/** Réponse de GET /api/plugins : un plugin actif, un inactif, un en erreur. */
export function somePlugins(): PluginInfo[] {
  return [
    { id: 'mise', name: 'Tâches mise', description: 'Lance les tâches mise du projet dans un terminal.', enabled: true, error: null },
    { id: 'xcode', name: 'Xcode', description: 'Build, test et lancement sur simulateur.', enabled: false, error: null },
    { id: 'gradle', name: 'Gradle', description: 'Tâches Gradle.', enabled: false, error: 'API de plugin non supportée (2)' },
  ];
}

export function aProject(overrides: Partial<Project> = {}): Project {
  return { path: '~/dev/meeplebox', kind: 'ios', branch: 'feat/suggestions', lastTs: 1_700_000_000_000, ...overrides };
}

/** Projets récents de démo, du plus récent au plus ancien (le premier est le dossier par défaut). */
export const PROJECTS: Project[] = [
  aProject(),
  aProject({ path: '~/dev/vigie', kind: 'node', branch: 'main', lastTs: 1_699_990_000_000 }),
  aProject({ path: '~/dev/vigie/ui', kind: 'node', branch: 'main', lastTs: 1_699_900_000_000 }),
  aProject({ path: '~/notes', kind: null, branch: null, lastTs: null }),
];

/** GET /api/projects simulé : récents sans '/', sinon enfants directs du chemin qui commencent par son dernier segment. */
export function fakeProjects(list: Project[] = PROJECTS) {
  return (q: () => string | undefined = () => '') => fakeResource(computed(() => {
    const v = q();
    if (v === undefined) return [];
    if (!v.includes('/')) return list;
    const dir = v.slice(0, v.lastIndexOf('/') + 1), seg = v.slice(dir.length);
    return list.filter((p) => p.path.startsWith(dir) && !p.path.slice(dir.length).includes('/') && p.path.slice(dir.length).startsWith(seg));
  }));
}

/** États d'une fausse ressource ; un signal les fait changer en cours de spec (chargement, échec). */
type FakeStatus = 'resolved' | 'error' | 'loading';

/**
 * Resource figée, typée comme celle d'`httpResource` : assez pour les VM qui lisent value()/hasValue()/status()/error(), et
 * `set` / `reload` comme la vraie. Comme Angular, `value()` lève en état d'erreur (ResourceValueError) : une lecture non gardée
 * par `hasValue()` fait échouer le spec au lieu de passer à tort. `value` peut être un signal (valeur dérivée, lectures espionnées).
 */
export function fakeResource<T>(value: T | Signal<T>, status: FakeStatus | Signal<FakeStatus> = 'resolved', error?: Error): HttpResourceRef<T> {
  const derived = (v: T | Signal<T>): v is Signal<T> => isSignal(v);
  const own = signal<T>(derived(value) ? untracked(value) : value);
  const current = derived(value) ? value : own;
  const state = isSignal(status) ? status : signal(status);
  const read = () => {
    if (state() === 'error') throw new Error(`Resource is currently in an error state: ${error?.message ?? 'erreur'}`);
    return current();
  };
  const set = (v: T) => own.set(v);
  const update = (fn: (v: T) => T) => own.update(fn);
  const ref = {
    value: Object.assign(read, { set, update, asReadonly: () => read }),
    hasValue: () => state() !== 'error' && current() !== undefined,
    status: computed(() => state()), error: signal(error).asReadonly(), isLoading: computed(() => state() === 'loading'),
    headers: signal(undefined), statusCode: signal(undefined), progress: signal(undefined),
    set, update, asReadonly: () => ref, reload: vi.fn(() => true), destroy: vi.fn(),
  };
  // Seul cast des fausses ressources : l'objet a la forme d'une HttpResourceRef sans en être une (pas de nœud réactif interne).
  return ref as unknown as HttpResourceRef<T>;
}

export function provideVigieServiceMock(overrides: Partial<VigieService> = {}): Provider {
  // Comme le vrai service : une seule ressource de réglages (sauf celle d'un spec), mise à jour par saveSettings.
  const settings = fakeResource<Settings | undefined>(aSettings());
  const mock: Partial<VigieService> = {
    snapshot: signal(aSnapshot()),
    connected: signal(true),
    incompatible: signal(false),
    wakes: signal(0),
    projectsResource: fakeProjects(),
    sessionResource: () => fakeResource(undefined),
    usageResource: () => fakeResource(undefined),
    settingsResource: () => settings,
    saveSettings: vi.fn(async (body: SettingsBody) => {
      const res = mock.settingsResource!();
      const saved = aSettings({ ...(res.hasValue() ? res.value() : {}), ...body });
      res.set(saved);
      return saved;
    }),
    sessionCost: vi.fn(async () => aSessionCost()),
    startSession: vi.fn(),
    openShell: vi.fn(),
    startChat: vi.fn(async () => aTerminal({ id: 't-chat', sessionId: 'chat1' })),
    purgeChat: vi.fn(async () => ({})),
    resumeSession: vi.fn(async () => aTerminal()),
    sessionLog: vi.fn(async () => ({ entries: [] })),
    configResource: () => fakeResource(undefined),
    traceResource: () => fakeResource(undefined),
    gitResource: () => fakeResource(undefined),
    pluginsResource: () => fakeResource(somePlugins()),
    togglePlugin: vi.fn(async (id: string, enabled: boolean) => ({ ...somePlugins().find((p) => p.id === id)!, enabled })),
    sessionPluginsResource: () => fakeResource([{ id: 'mise', name: 'Tâches mise' }]),
    // ponytail: `null` pour toute méthode ; des réponses par plugin et méthode quand une spec du cœur en aura besoin
    // (les specs des plugins passent par fakePluginHost, pas par ce mock).
    pluginCall: vi.fn(async () => null),
    // Une action ouvre un terminal (201 du daemon).
    pluginAction: vi.fn(async () => ({ terminal: aTerminal({ id: 't9', kind: 'shell', title: 'test' }) })),
    gitFile: vi.fn(async (_id: string, path: string) => ({ path, content: 'export const a = 1;\n', hash: 'a'.repeat(64) })),
    writeFile: vi.fn(async () => ({ ok: true })),
    files: vi.fn(async () => aProjectFiles()),
    readProjectFile: vi.fn(async (_id: string, path: string) => ({ path, content: 'export const a = 1;\n', hash: 'a'.repeat(64) })),
    writeProjectFile: vi.fn(async () => ({ ok: true })),
    searchFiles: vi.fn(async () => aSearchResults()),
    closeTerminal: vi.fn(async () => ({ ok: true })),
    sendKeys: vi.fn(async () => ({ ok: true })),
    deleteSession: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  return { provide: VigieService, useValue: mock };
}

/** Config Claude de démo pour les tests de l'onglet Config. */
export const aConfig = (extra: Partial<ClaudeConfig> = {}): ClaudeConfig => ({
  cwd: '~/dev/revu', model: 'opus', settings: [], instructions: [], skills: [], agents: [], hooks: [],
  permissions: [{ scope: 'projet', kind: 'allow', rule: 'Bash(npm test)' }, { scope: 'utilisateur', kind: 'deny', rule: 'Read(./.env*)' }],
  commands: [{ scope: 'projet', name: 'revue', description: 'Relit le diff en cours', path: '~/dev/revu/.claude/commands/revue.md', body: 'Relis le diff et liste les risques.' }],
  mcp: [], plugins: [], env: [],
  checks: [{ level: 'error', area: 'Skills', message: '« revue » : description manquante', path: '~/dev/revu/.claude/skills/revue/SKILL.md' }],
  ...extra,
});
