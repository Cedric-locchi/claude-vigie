import { Provider, computed, signal } from '@angular/core';
import { vi } from 'vitest';
import { Agent, ClaudeConfig, MiseTasks, Project, ProjectFiles, SessionCost, SessionSummary, Settings, Snapshot, Terminal, Usage, UsageRow, UsageRows, XcodeProject, XcodeTargets } from './models';
import { VigieService } from './vigie.service';

export function aSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1', project: 'meeplebox', cwd: '/dev/meeplebox', branch: 'feat/suggestions', model: 'claude-opus-5-5',
    title: 'Moteur de suggestions', lastText: 'Tests verts.', tool: 'Bash · xcodebuild test',
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
  return { now: 120_000, sessions: [aSession()], usage: anUsage(), terminals: [], claudeStatus: { indicator: 'none', incidents: [] }, ...overrides };
}

export function anAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'main', name: 'Claude', sub: false, description: '', state: 'running', lastAction: null, lastText: '',
    tokens: 120_000, toolCount: 4, firstTs: 1_000, lastTs: 60_000, bars: [], cost: 1.8, ...overrides,
  };
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

export function aProjectFiles(overrides: Partial<ProjectFiles> = {}): ProjectFiles {
  return { root: '/dev/meeplebox', repo: true, files: ['src/a.ts', '.env', 'README.md'], collapsed: ['node_modules'], truncated: false, ...overrides };
}

/** Réponse de GET /api/sessions/:id/mise : une tâche du projet, une globale (l'UI filtre). */
export function aMiseTasks(overrides: Partial<MiseTasks> = {}): MiseTasks {
  return {
    available: true, untrusted: false, error: null,
    tasks: [
      { name: 'test', aliases: ['t'], description: 'Lance les tests', source: 'mise.toml', depends: ['build'], run: ['npm test'], file: null, global: false },
      { name: 'cleanup', aliases: [], description: '', source: '~/.config/mise/config.toml', depends: [], run: ['rm -rf tmp'], file: null, global: true },
    ],
    ...overrides,
  };
}

/** Réponse de GET /api/sessions/:id/xcode : un workspace iOS et deux scripts. */
export function anXcodeProject(overrides: Partial<XcodeProject> = {}): XcodeProject {
  return { container: { kind: 'workspace', name: 'App.xcworkspace' }, scripts: ['bootstrap.sh', 'lint.py'], ...overrides };
}

/** Réponse de GET /api/sessions/:id/xcode/targets : deux schemes, trois simulateurs sur deux runtimes, le second démarré. */
export function anXcodeTargets(overrides: Partial<XcodeTargets> = {}): XcodeTargets {
  return {
    available: true, error: null,
    schemes: ['App', 'AppTests'],
    simulators: [
      { udid: '11111111-1111-1111-1111-111111111111', name: 'iPhone 16', runtime: 'iOS 18.0', booted: false },
      { udid: '22222222-2222-2222-2222-222222222222', name: 'iPhone 16 Pro', runtime: 'iOS 18.0', booted: true },
      { udid: '33333333-3333-3333-3333-333333333333', name: 'iPhone 15', runtime: 'iOS 17.5', booted: false },
    ],
    ...overrides,
  };
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
  return (q: () => string | undefined = () => '') => {
    const value = computed(() => {
      const v = q();
      if (v === undefined) return [];
      if (!v.includes('/')) return list;
      const dir = v.slice(0, v.lastIndexOf('/') + 1), seg = v.slice(dir.length);
      return list.filter((p) => p.path.startsWith(dir) && !p.path.slice(dir.length).includes('/') && p.path.slice(dir.length).startsWith(seg));
    });
    return { value, hasValue: () => true, status: signal('resolved'), error: signal(undefined), isLoading: signal(false), reload: vi.fn() };
  };
}

/** Resource figée : assez pour les VM qui lisent value()/hasValue()/status(). */
export function fakeResource<T>(value: T | undefined, status: 'resolved' | 'error' | 'loading' = 'resolved', error?: Error) {
  return { value: signal(value), hasValue: () => value !== undefined, status: signal(status), error: signal(error), isLoading: signal(status === 'loading'), reload: vi.fn() };
}

export function provideVigieServiceMock(overrides: Partial<VigieService> = {}): Provider {
  return {
    provide: VigieService,
    useValue: {
      snapshot: signal(aSnapshot()),
      connected: signal(true),
      incompatible: signal(false),
      wakes: signal(0),
      projectsResource: fakeProjects() as unknown as VigieService['projectsResource'],
      sessionResource: (() => fakeResource(undefined)) as unknown as VigieService['sessionResource'],
      usageResource: (() => fakeResource(undefined)) as unknown as VigieService['usageResource'],
      settingsResource: (() => fakeResource(aSettings())) as unknown as VigieService['settingsResource'],
      saveSettings: vi.fn(async (body) => aSettings({ ...body, locale: body.locale ?? null, alerts: body.alerts ?? { dailyCost: null, windowPct: null } })),
      sessionCost: vi.fn(async () => aSessionCost()),
      startSession: vi.fn(),
      openShell: vi.fn(),
      startChat: vi.fn(async () => ({ sessionId: 'chat1' }) as Terminal),
      purgeChat: vi.fn(async () => ({})),
      resumeSession: vi.fn(async () => ({}) as Terminal),
      sessionLog: vi.fn(async () => ({ entries: [] })),
      configResource: (() => fakeResource(undefined)) as unknown as VigieService['configResource'],
      traceResource: (() => fakeResource(undefined)) as unknown as VigieService['traceResource'],
      gitResource: (() => fakeResource(undefined)) as unknown as VigieService['gitResource'],
      miseResource: (() => fakeResource(aMiseTasks())) as unknown as VigieService['miseResource'],
      xcodeResource: (() => fakeResource(anXcodeProject())) as unknown as VigieService['xcodeResource'],
      xcodeTargetsResource: (() => fakeResource(anXcodeTargets())) as unknown as VigieService['xcodeTargetsResource'],
      openXcode: vi.fn(async () => ({ ok: true })),
      gitFile: vi.fn(async (_id: string, path: string) => ({ path, content: 'export const a = 1;\n', hash: 'a'.repeat(64) })),
      writeFile: vi.fn(async () => ({ ok: true })),
      files: vi.fn(async () => aProjectFiles()),
      readProjectFile: vi.fn(async (_id: string, path: string) => ({ path, content: 'export const a = 1;\n', hash: 'a'.repeat(64) })),
      writeProjectFile: vi.fn(async () => ({ ok: true })),
      closeTerminal: vi.fn(async () => ({ ok: true })),
      sendKeys: vi.fn(async () => ({ ok: true })),
      deleteSession: vi.fn(async () => ({ ok: true })),
      ...overrides,
    } satisfies Partial<VigieService>,
  };
}

/** Config Claude de démo pour les tests de l'onglet Config. */
export const aConfig = (extra: Partial<ClaudeConfig> = {}): ClaudeConfig => ({
  cwd: '~/dev/revu', model: 'opus', settings: [], instructions: [], skills: [], agents: [], commands: [], hooks: [],
  permissions: [{ scope: 'projet', kind: 'allow', rule: 'Bash(npm test)' }, { scope: 'utilisateur', kind: 'deny', rule: 'Read(./.env*)' }],
  mcp: [], plugins: [], env: [],
  checks: [{ level: 'error', area: 'Skills', message: '« revue » : description manquante', path: '~/dev/revu/.claude/skills/revue/SKILL.md' }],
  ...extra,
});
