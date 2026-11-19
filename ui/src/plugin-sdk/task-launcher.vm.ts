import { Injectable, Signal, computed, linkedSignal, signal } from '@angular/core';

/** Une tâche du lanceur. `id` unique dans le lanceur ; `scope` : workspace ou projet, affiché en petit et dit dans le
 *  libellé accessible ; `hint` : ce que fait la tâche (sinon `command` sert d'indication) ; `disabledReason` : tâche non
 *  lançable, raison courte visible ; `keywords` : termes de recherche en plus (alias, type…). */
export interface LauncherTask {
  id: string;
  name: string;
  scope?: string | null;
  hint?: string | null;
  command?: string | null;
  disabledReason?: string | null;
  keywords?: readonly string[];
}

/** Un thème : une rubrique du lanceur (navigation à gauche, ses tâches à droite). */
export interface TaskTheme {
  id: string;
  label: string;
  tasks: LauncherTask[];
}

/** Ce que le composant branche dans le VM : ses entrées et sa sortie `run`. */
export interface LauncherSource {
  themes: Signal<readonly TaskTheme[]>;
  launching: Signal<string | null>;
  storageKey: Signal<string>;
  run: (task: LauncherTask) => void;
}

/** Libellé accessible du bouton : unique même quand deux workspaces ont un script du même nom. */
export const launchLabel = (t: LauncherTask) => `Lancer ${t.name}${t.scope ? ` dans ${t.scope}` : ''}`;

/** « / » met le focus dans la recherche, sauf quand on tape déjà dans un champ (terminal xterm compris : c'est un textarea). */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = e.target as HTMLElement | null;
  return !el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

const PREFIX = 'vigie.launcher.theme.';
// Préférence de ce navigateur : stockage bloqué ou illisible = premier thème, écriture ignorée.
function readSaved(key: string): string | null {
  try { return globalThis.localStorage?.getItem(PREFIX + key) ?? null; } catch { return null; }
}
function writeSaved(key: string, id: string): void {
  try { globalThis.localStorage?.setItem(PREFIX + key, id); } catch { /* stockage bloqué */ }
}

/**
 * Lanceur de tâches (SDK des plugins) : recherche, thème choisi mémorisé par clé (plugin + dossier), première tâche
 * du thème affiché pour « Entrée », garde-fou d'un lancement à la fois.
 */
@Injectable()
export class TaskLauncherVm {
  private readonly src = signal<LauncherSource | null>(null);

  connect(src: LauncherSource): void {
    this.src.set(src);
  }

  readonly search = signal('');
  private readonly query = computed(() => this.search().trim().toLowerCase());
  private readonly themes = computed(() => this.src()?.themes() ?? []);
  readonly launching = computed(() => this.src()?.launching() ?? null);
  readonly count = computed(() => this.themes().reduce((n, t) => n + t.tasks.length, 0));

  /** Thème choisi par l'utilisateur, relu quand la clé change. */
  private readonly selected = linkedSignal(() => readSaved(this.src()?.storageKey() ?? ''));

  /** Thèmes filtrés par la recherche (nom, workspace, indication, commande, mots-clés ; un thème qui correspond garde
   *  toutes ses tâches). Un thème sans tâche visible disparaît de la navigation. */
  readonly visible = computed(() => {
    const q = this.query();
    const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q);
    return this.themes()
      .map((th) => ({ ...th, tasks: !q || hit(th.label) ? th.tasks : th.tasks.filter((t) => [t.name, t.scope, t.hint, t.command, ...(t.keywords ?? [])].some(hit)) }))
      .filter((th) => th.tasks.length);
  });

  /** Thème affiché : le choisi s'il reste visible (la recherche peut l'écarter), sinon le premier. */
  readonly current = computed(() => {
    const v = this.visible();
    return v.find((th) => th.id === this.selected()) ?? v.at(0) ?? null;
  });

  /** Première tâche lançable du thème affiché : « Entrée » dans la recherche la lance. */
  readonly first = computed(() => {
    const th = this.current();
    const t = th?.tasks.find((x) => !x.disabledReason);
    return th && t ? { task: t, theme: th.label } : null;
  });

  select(id: string): void {
    this.selected.set(id);
    writeSaved(this.src()?.storageKey() ?? '', id);
  }

  readonly label = launchLabel;
  /** Infobulle de l'indication : la description entière, puis la commande. */
  title(t: LauncherTask): string {
    return [t.hint, t.command].filter(Boolean).join('\n');
  }

  /** Les boutons ne sont jamais `disabled` (le focus reste) : le garde-fou est ici. */
  run(task: LauncherTask | null | undefined): void {
    if (!task || task.disabledReason || this.launching() !== null) return;
    this.src()?.run(task);
  }

  runFirst(): void {
    this.run(this.first()?.task);
  }
}

// --- Thèmes par nature de script (npm, nx) ---

export const NATURES = [
  { id: 'dev', label: 'Développement' },
  { id: 'build', label: 'Build' },
  { id: 'test', label: 'Tests' },
  { id: 'quality', label: 'Qualité' },
  { id: 'publish', label: 'Publication' },
  { id: 'lifecycle', label: 'Cycle de vie' },
  { id: 'other', label: 'Autres' },
] as const;
export type Nature = (typeof NATURES)[number]['id'];

// Scripts que npm lance de lui-même (install, pack, publish…).
const LIFECYCLE = new Set(['prepare', 'preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'preuninstall', 'uninstall', 'postuninstall', 'dependencies']);

/**
 * Nature d'un script ou d'une cible, d'après son nom (`build:prod` → build, `lint-fix` → quality). `siblings` : les autres
 * noms du même package ou projet, pour reconnaître `prebuild` / `postbuild` (crochets de `build`).
 * ponytail: heuristique sur le premier mot du nom ; un script mal nommé tombe dans « Autres ».
 */
export function natureOf(name: string, siblings: ReadonlySet<string>): Nature {
  if (LIFECYCLE.has(name)) return 'lifecycle';
  const base = name.startsWith('pre') ? name.slice(3) : name.startsWith('post') ? name.slice(4) : '';
  if (base && siblings.has(base)) return 'lifecycle';
  const head = name.toLowerCase().split(/[:\-_.\s/]/)[0];
  if (/^(dev|start|serve|watch|preview|storybook)/.test(head)) return 'dev';
  if (/^(build|compile|bundle|dist)/.test(head)) return 'build';
  if (/^(test|e2e|coverage)/.test(head)) return 'test';
  if (/^(lint|format|fmt|typecheck|check)/.test(head)) return 'quality';
  if (/^(release|publish|version)$|^deploy/.test(head)) return 'publish';
  return 'other';
}

/** Range des tâches dans les thèmes par nature (ordre fixe, thèmes vides retirés), dans l'ordre reçu. */
export function natureThemes(items: readonly { task: LauncherTask; name: string; siblings: ReadonlySet<string> }[]): TaskTheme[] {
  const by = new Map<Nature, LauncherTask[]>();
  for (const { task, name, siblings } of items) {
    const n = natureOf(name, siblings);
    by.set(n, [...(by.get(n) ?? []), task]);
  }
  return NATURES.filter((n) => by.has(n.id)).map((n) => ({ id: n.id, label: n.label, tasks: by.get(n.id)! }));
}
