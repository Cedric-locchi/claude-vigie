import { DestroyRef, Injectable, Signal, computed, effect, inject, linkedSignal, resource, signal, untracked } from '@angular/core';
import { ConfirmService } from '../../../core/confirm.service';
import { languageOf } from '../../../core/highlight';
import { duration } from '../../../core/format';
import { isMarkdown, renderMarkdown } from '../../../core/markdown';
import { FileBody, GitFile, SessionTrace } from '../../../core/models';
import { CLIENT_OS, isShortcut } from '../../../core/platform';
import { readPref, writePref } from '../../../core/prefs';
import { counter, keepLast } from '../../../core/signals';
import { VigieService } from '../../../core/vigie.service';
import { GitMark, gitMarks, lineCol, lineCount, lineOffset } from './code-editor/code-editor';
import { Touched, autoOpen, editedDirs, pathResolver, touchedFiles, visibleFiles } from './touched/files-touched';
import { Here, claudeFile, withFullPath } from './claude-here/claude-here';
import { SessionPageVm } from '../session-page/session-page.vm';
import { STATUS, message } from '../diff/session-diff.vm';

const WRAP_KEY = 'vigie.files.wrap';
const readWrap = (): boolean => readPref(WRAP_KEY) === '1';
const WIDTH_KEY = 'vigie.files.width';
const COLLAPSED_KEY = 'vigie.files.collapsed';
const FOLLOW_KEY = 'vigie.files.follow';
const SIDE_KEY = 'vigie.files.side';
/** Largeur du panneau latéral (px), bornée. */
export const sideWidth = (px: number): number => Math.round(Math.min(560, Math.max(180, px || 280)));

/** Fenêtre d'outil du panneau, choisie dans la barre d'activité. */
export type SideView = 'project' | 'search' | 'claude';
/** Une préférence inconnue (anciennes vues comprises) retombe sur Projet. */
const SIDES: SideView[] = ['project', 'search', 'claude'];

/** Dossier de l'arbre : sous-dossiers et fichiers (chemins complets), triés. */
export interface Dir { dirs: string[]; files: string[] }
/** Ligne affichée de l'arbre ; `ignored` : dossier listé sans son contenu (ignoré par git), non dépliable. */
export interface Row { path: string; name: string; depth: number; kind: 'dir' | 'file' | 'ignored'; open: boolean }

const parent = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
export const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const byName = (a: string, b: string): number => collator.compare(base(a), base(b));
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

/** Liste plate du daemon → dossiers indexés par chemin ('' = racine), enfants triés par nom. */
export function buildTree(files: string[], collapsed: string[]): Map<string, Dir> {
  const tree = new Map<string, Dir>([['', { dirs: [], files: [] }]]);
  const dir = (path: string): Dir => {
    let d = tree.get(path);
    if (!d) {
      d = { dirs: [], files: [] };
      tree.set(path, d);
      dir(parent(path)).dirs.push(path);
    }
    return d;
  };
  for (const f of files) dir(parent(f)).files.push(f);
  for (const c of collapsed) dir(c);
  for (const d of tree.values()) { d.dirs.sort(byName); d.files.sort(byName); }
  return tree;
}

/** Déplacement clavier dans l'arbre (motif ARIA « tree ») : ligne à focaliser, dossier à plier/déplier, fichier à ouvrir. */
export interface TreeMove { focus: number; toggle?: string; open?: string }

export function treeKey(rows: Row[], i: number, key: string): TreeMove | null {
  const r = rows[i];
  if (!r) return rows.length ? { focus: 0 } : null;
  switch (key) {
    case 'ArrowDown': return { focus: Math.min(i + 1, rows.length - 1) };
    case 'ArrowUp': return { focus: Math.max(i - 1, 0) };
    case 'Home': return { focus: 0 };
    case 'End': return { focus: rows.length - 1 };
    case 'ArrowRight':
      if (r.kind === 'dir' && !r.open) return { focus: i, toggle: r.path };
      return { focus: r.kind === 'dir' && rows[i + 1]?.depth > r.depth ? i + 1 : i };
    case 'ArrowLeft':
      if (r.kind === 'dir' && r.open) return { focus: i, toggle: r.path };
      for (let j = i - 1; j >= 0; j--) if (rows[j].depth < r.depth) return { focus: j };
      return { focus: i };
    case 'Enter':
    case ' ':
      return r.kind === 'file' ? { focus: i, open: r.path } : r.kind === 'dir' ? { focus: i, toggle: r.path } : { focus: i };
  }
  return null;
}

/** Onglet de fichier ouvert ; `draft` non null = en édition (un brouillon par onglet) ; `preview` : remplacé par la prochaine ouverture depuis l'arbre. */
export interface Tab { path: string; body: FileBody | null; error: string | null; draft: string | null; conflict: boolean; preview?: boolean }

export const isDirty = (t: Tab): boolean => t.draft !== null && lf(t.draft) !== lf(t.body?.content ?? '');

export const MAX_TABS = 8;

/**
 * Ajoute l'onglet (sans doublon) ; au-delà du plafond, le plus ancien sans saisie en cours se ferme.
 * En aperçu, il prend la place de l'onglet d'aperçu existant (sans saisie), comme dans VS Code.
 */
export function openTab(tabs: Tab[], path: string, max = MAX_TABS, preview = false): Tab[] {
  if (tabs.some((t) => t.path === path)) return tabs;
  const tab: Tab = { path, body: null, error: null, draft: null, conflict: false, preview };
  const p = preview ? tabs.findIndex((t) => t.preview && t.draft === null) : -1;
  if (p >= 0) return tabs.map((t, i) => (i === p ? tab : t));
  const next = [...tabs, tab];
  // ponytail: le plus ancien ouvert, pas le moins récemment consulté ; tous modifiés → on dépasse le plafond plutôt que de perdre une saisie.
  if (next.length > max) {
    const i = next.findIndex((t) => !isDirty(t));
    if (i >= 0 && i < next.length - 1) next.splice(i, 1);
  }
  return next;
}

/** Retire l'onglet ; s'il était actif, son voisin de droite (sinon de gauche) le devient. */
export function closeTab(tabs: Tab[], path: string, active: string | null): { tabs: Tab[]; active: string | null } {
  const i = tabs.findIndex((t) => t.path === path);
  if (i < 0) return { tabs, active };
  const next = tabs.filter((_, j) => j !== i);
  return { tabs: next, active: active === path ? ((next[i] ?? next[i - 1])?.path ?? null) : active };
}

/** Lettres de `q` dans l'ordre dans `s` (premier endroit possible) : bonus aux lettres consécutives et aux débuts de mot. */
function subseq(s: string, q: string): number | null {
  let from = 0, last = -2, score = 0;
  for (const c of q) {
    const j = s.indexOf(c, from);
    if (j < 0) return null;
    score += (j === last + 1 ? 5 : 0) + (j === 0 || '/._-'.includes(s[j - 1]) ? 4 : 0);
    last = j;
    from = j + 1;
  }
  return score;
}

/**
 * Fenêtre « Aller au fichier » : correspondance floue sur le chemin, bonus si tout tient dans le nom du fichier ;
 * le chemin le plus court départage. null : pas de correspondance.
 */
export function fuzzy(path: string, q: string): number | null {
  const p = path.toLowerCase(), full = subseq(p, q);
  if (full === null) return null;
  const name = subseq(p.slice(p.lastIndexOf('/') + 1), q);
  return Math.max(full, name === null ? -Infinity : name + 10) - p.length / 1000;
}

/** Meilleurs chemins pour la saisie (espaces ignorés). */
// ponytail: parcours complet à chaque frappe (≤ 20 000 chemins, quelques ms) ; index trigramme si ça rame.
export function quickMatch(files: string[], query: string, max = 50): string[] {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return files.slice(0, max);
  const hits: { f: string; s: number }[] = [];
  for (const f of files) { const s = fuzzy(f, q); if (s !== null) hits.push({ f, s }); }
  return hits.sort((a, b) => b.s - a.s).slice(0, max).map((h) => h.f);
}

/** Vue Fichiers : arbre du projet, ce que Claude touche, onglets de fichiers ouverts, lecture et édition (mêmes règles que l'édition du Diff). */
@Injectable()
export class SessionFilesVm {
  private readonly vigie = inject(VigieService);
  private readonly confirm = inject(ConfirmService);
  private readonly mac = inject(CLIENT_OS) === 'mac';
  /** Libellés de raccourci selon la plateforme du client (⌘ sur mac, Ctrl ailleurs). */
  readonly keys = this.mac ? { mod: '⌘', shift: '⇧', aria: 'Meta' } : { mod: 'Ctrl+', shift: 'Shift+', aria: 'Control' };
  private readonly source = signal<{ id: Signal<string>; idle: Signal<boolean> } | null>(null);
  /** Session affichée (lue aussi par la recherche dans le contenu). */
  readonly id = computed(() => this.source()?.id() ?? null);
  /** Claude ne travaille pas : l'écriture est permise (le daemon applique la même règle, 409 sinon). */
  readonly idle = computed(() => this.source()?.idle() ?? false);

  /** Change quand Claude se met au travail ou s'arrête : arbre et trace sont relus à ces moments-là, pas à chaque événement. */
  private readonly version = counter(this.idle);

  // Chargée à l'ouverture de la vue (le composant n'existe que quand il est affiché), puis à chaque changement d'état de la session.
  private readonly list = resource({ params: () => { const id = this.id(); return id ? { id, v: this.version() } : undefined; }, loader: ({ params }) => this.vigie.files(params.id) });
  /** Garde l'arbre affiché pendant une relecture (pas de clignotement). */
  readonly project = keepLast(this.list, this.id);
  /** Fichiers du projet, sans les fichiers système. */
  readonly files = computed(() => visibleFiles(this.project()?.files ?? []));
  readonly loading = computed(() => this.list.isLoading());
  readonly listError = computed(() => (this.list.status() === 'error' ? message(this.list.error()) : null));

  /** État git (statuts de l'arbre, marqueurs de gouttière) : relu à chaque lecture de fichier, pour rester cohérent avec le contenu affiché. */
  private readonly gitVersion = signal(0);
  private readonly git = this.vigie.gitResource(this.id, this.gitVersion);
  /** Garde le dernier état git de la session pendant un rechargement : pas de clignotement des marqueurs. */
  private readonly gitDiff = keepLast(this.git, this.id);
  /** Statut git par fichier, et dossiers qui contiennent un changement. */
  readonly changes = computed(() => {
    const files = new Map<string, GitFile>(), dirs = new Set<string>();
    for (const f of this.gitDiff()?.files ?? []) {
      files.set(f.path, f);
      for (let d = parent(f.path); d && !dirs.has(d); d = parent(d)) dirs.add(d);
    }
    return { files, dirs };
  });
  readonly STATUS = STATUS;
  /** Branche git du projet (barre d'état) ; null hors dépôt ou HEAD détachée. */
  readonly branch = computed(() => this.gitDiff()?.branch ?? null);

  private readonly tree = computed(() => {
    const p = this.project();
    return p ? { dirs: buildTree(this.files(), p.collapsed), ignored: new Set(p.collapsed) } : null;
  });

  readonly expanded = linkedSignal<string | null, Set<string>>({ source: this.id, computation: () => new Set() });

  // ── Barre d'activité et fenêtre d'outil : redimensionnable, masquable ; tiroir sur écran étroit ──
  readonly side = signal<SideView>(SIDES.find((v) => v === readPref(SIDE_KEY)) ?? 'project');
  readonly width = signal(sideWidth(Number(readPref(WIDTH_KEY))));
  /** Replié par l'utilisateur (largeurs confortables), mémorisé. */
  readonly collapsed = signal(readPref(COLLAPSED_KEY) === '1');
  /** Largeurs étroites : le panneau est un tiroir posé sur l'éditeur (le composant suit la media query). */
  readonly narrow = signal(false);
  /** Tiroir ouvert (largeurs étroites seulement). */
  readonly drawer = signal(false);
  /** Panneau visible à l'écran : tiroir ouvert en étroit, non replié ailleurs. */
  readonly panelShown = computed(() => (this.narrow() ? this.drawer() : !this.collapsed()));
  /** Vue affichée à l'écran (bouton actif de la barre d'activité). */
  isShown(v: SideView): boolean { return this.side() === v && this.panelShown(); }
  /** Clic dans la barre d'activité : affiche la vue et rouvre le panneau masqué ; la vue déjà affichée ne bouge pas. */
  showSide(v: SideView): void {
    if (this.isShown(v)) return;
    this.side.set(v);
    writePref(SIDE_KEY, v);
    this.showPanel(true);
  }
  showPanel(on: boolean): void {
    if (this.narrow()) return this.drawer.set(on);
    this.collapsed.set(!on);
    writePref(COLLAPSED_KEY, on ? '0' : '1');
  }
  resize(px: number): void {
    this.width.set(sideWidth(px));
    writePref(WIDTH_KEY, String(this.width()));
  }

  /** Lignes visibles de l'arbre : seuls les dossiers dépliés sont parcourus. */
  readonly rows = computed(() => {
    const t = this.tree(), rows: Row[] = [];
    if (!t) return rows;
    const expanded = this.expanded();
    const walk = (dir: string, depth: number): void => {
      const d = t.dirs.get(dir)!;
      for (const c of d.dirs) {
        const ignored = t.ignored.has(c), open = !ignored && expanded.has(c);
        rows.push({ path: c, name: base(c), depth, kind: ignored ? 'ignored' : 'dir', open });
        if (open) walk(c, depth + 1);
      }
      for (const f of d.files) rows.push({ path: f, name: base(f), depth, kind: 'file', open: false });
    };
    walk('', 0);
    return rows;
  });

  // ── Ce que Claude a touché (trace de la session) ─────────────────────────
  /** Un sous-agent travaille : la trace est relue toutes les 5 s (le daemon ne donne en direct que l'outil de l'agent principal). */
  private readonly subTick = signal(0);
  private readonly subActive = computed(() => (this.page?.summary()?.activeSubagents ?? 0) > 0 && !this.idle());
  private readonly traceRes = this.vigie.traceResource(this.id, computed(() => this.version() + this.subTick()));
  private readonly trace = linkedSignal<{ id: string | null; value: SessionTrace | undefined }, SessionTrace | null>({
    source: () => ({ id: this.id(), value: this.traceRes.hasValue() ? this.traceRes.value() : undefined }),
    computation: (s, prev) => s.value ?? (prev?.source.id === s.id ? prev.value : null),
  });
  /** Fichiers lus ou modifiés par Claude, du plus récent au plus ancien. */
  readonly touched = computed(() => { const p = this.project(); return p ? touchedFiles(this.trace(), p.root, this.files()) : []; });
  readonly touchedByPath = computed(() => new Map(this.touched().map((t) => [t.path, t])));
  /** Nombre de fichiers modifiés par Claude sous chaque dossier. */
  readonly editedDirs = computed(() => editedDirs(this.touched()));
  /** Horloge des âges (« 2 min ») : la trace n'est relue qu'aux changements d'état. */
  private readonly now = signal(Date.now());
  /** Âge lisible d'un fichier touché. */
  age(t: Touched): string { return duration(this.now() - t.at); }
  /** Le fichier actif tel que Claude l'a touché (mention « Modifié par Claude au tour N »). */
  readonly activeTouch = computed(() => this.touchedByPath().get(this.active()?.path ?? '') ?? null);
  private readonly page = inject(SessionPageVm, { optional: true });
  /** « Voir dans l'historique » : possible seulement dans la page session (journal filtré sur le fichier). */
  readonly canShowHistory = !!this.page;
  showInHistory(t: Touched): void { this.page?.openLog(t.label); }

  // ── Claude ici : le fichier que Claude lit ou modifie en ce moment ───────
  private readonly resolve = computed(() => { const p = this.project(); return p ? pathResolver(p.root, this.files()) : null; });
  /** Tour en cours dans la trace (relue quand Claude se met au travail). */
  private readonly liveTurn = computed(() => this.trace()?.turns.find((t) => t.live)?.index ?? null);
  /**
   * Déduit en direct du snapshot (outil en cours, ou détail de l'attente), sinon le dernier fichier touché pendant le tour en cours ;
   * null quand Claude ne travaille pas (Lights-Out). Égalité par chemin et nature : pas de réveil à chaque snapshot.
   * ponytail: un sous-agent qui écrit apparaît au prochain relevé de la trace (5 s) ; une cible live dans le résumé du daemon éviterait la relecture.
   */
  readonly here = computed<Here | null>(() => {
    const r = this.resolve(), s = this.page?.summary();
    if (this.idle() || !r) return null;
    const live = this.liveTurn(), last = live === null ? undefined : this.touched().find((t) => t.turn === live);
    return claudeFile([s?.detail, withFullPath(s?.tool, s?.toolPath)], r) ?? (last ? { path: last.path, edit: last.editTurn === last.turn } : null);
  }, { equal: (a, b) => a?.path === b?.path && a?.edit === b?.edit });
  /** « Suivre » : chaque nouveau fichier touché par Claude s'ouvre en aperçu ; mémorisé pour toutes les sessions. */
  readonly follow = signal(readPref(FOLLOW_KEY) === '1');
  toggleFollow(): void {
    const v = !this.follow();
    this.follow.set(v);
    writePref(FOLLOW_KEY, v ? '1' : '0');
  }

  /** Retour à la ligne dans l'éditeur, mémorisé pour toutes les sessions. */
  readonly wrap = signal(readWrap());
  toggleWrap(): void {
    const v = !this.wrap();
    this.wrap.set(v);
    writePref(WRAP_KEY, v ? '1' : '0');
  }

  /** Ligne de l'arbre qui porte le tabindex (roving tabindex) : la dernière focalisée, sinon la première. */
  private readonly focused = signal<string | null>(null);
  readonly focusRow = computed(() => {
    const rows = this.rows(), f = this.focused();
    return rows.some((r) => r.path === f) ? f : (rows[0]?.path ?? null);
  });

  /** Session pour laquelle l'ouverture d'office a déjà été tentée (une fois, au premier chargement). */
  private autoOpened: string | null = null;

  constructor() {
    effect((onCleanup) => {
      if (!this.subActive()) return;
      const t = setInterval(() => this.subTick.update((n) => n + 1), 5_000);
      onCleanup(() => clearInterval(t));
    });
    const tick = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    // Suivre : ouvre en aperçu, jamais par-dessus un onglet en édition ; le tiroir reste comme il était.
    effect(() => {
      const h = this.here();
      if (!h || !this.follow()) return;
      untracked(() => {
        if (this.editing() || this.activePath() === h.path) return;
        const drawer = this.drawer();
        void this.open(h.path, true);
        this.drawer.set(drawer);
      });
    });
    // Claude se met au travail ou s'arrête : le fichier affiché est relu (sauf brouillon), comme l'arbre et la trace.
    effect(() => {
      if (!this.version()) return;
      untracked(() => {
        const id = this.id(), a = this.active();
        if (id && a?.body && a.draft === null) void this.read(id, a.path);
      });
    });
    // Premier chargement de l'arbre et de la trace, aucun onglet : ouvre le dernier fichier modifié par Claude.
    effect(() => {
      const id = this.id();
      if (!id || this.autoOpened === id || !this.project() || !this.trace()) return;
      this.autoOpened = id;
      const path = autoOpen(this.touched());
      if (path && !untracked(this.tabs).length) untracked(() => void this.open(path));
    });
  }

  connect(id: Signal<string>, idle: Signal<boolean>): void {
    this.source.set({ id, idle });
  }

  refresh(): void {
    this.list.reload();
    const id = this.id(), a = this.active();
    if (id && a && a.draft === null) void this.read(id, a.path);
    else this.gitVersion.update((v) => v + 1);
  }

  toggle(path: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  /** Clic sur une ligne de l'arbre. */
  pick(r: Row): void {
    this.focused.set(r.path);
    if (r.kind === 'file') void this.open(r.path, true);
    else if (r.kind === 'dir') this.toggle(r.path);
  }

  /** Touche dans l'arbre ; true si elle est prise en charge (le composant déplace alors le focus sur `focusRow`). */
  treeKey(key: string): boolean {
    const rows = this.rows();
    const move = treeKey(rows, rows.findIndex((r) => r.path === this.focusRow()), key);
    if (!move) return false;
    if (move.toggle) this.toggle(move.toggle);
    if (move.open) void this.open(move.open, true);
    this.focused.set(rows[move.focus].path);
    return true;
  }

  /**
   * Fil d'Ariane, « Localiser le fichier ouvert » : déplie le dossier (ou les dossiers parents d'un fichier) dans l'arbre,
   * y désigne la ligne au clavier et affiche la vue Projet.
   */
  reveal(path: string): void {
    const isDir = !!this.tree()?.dirs.has(path);
    this.expanded.update((s) => {
      const next = new Set(s);
      for (let d = isDir ? path : parent(path); d; d = parent(d)) next.add(d);
      return next;
    });
    this.focused.set(path);
    this.showSide('project');
  }

  /** « Localiser le fichier ouvert » ; false sans fichier ouvert. */
  locate(): boolean {
    const p = this.activePath();
    if (p) this.reveal(p);
    return !!p;
  }

  /** « Tout replier » : l'arbre revient à la racine. */
  collapseAll(): void { this.expanded.set(new Set()); }

  // ── Onglets ──────────────────────────────────────────────────────────────
  readonly tabs = linkedSignal<string | null, Tab[]>({ source: this.id, computation: () => [] });
  private readonly activePath = linkedSignal<string | null, string | null>({ source: this.id, computation: () => null });
  readonly active = computed(() => this.tabs().find((t) => t.path === this.activePath()) ?? null);
  readonly editing = computed(() => this.active()?.draft != null);
  readonly dirty = computed(() => { const a = this.active(); return !!a && isDirty(a); });
  readonly loadingFile = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Texte affiché : le brouillon en édition, sinon le fichier lu. */
  readonly text = computed(() => { const a = this.active(); return a?.draft ?? a?.body?.content ?? ''; });
  readonly crumbs = computed(() => {
    const p = this.active()?.path;
    return p ? p.split('/').map((name, i, all) => ({ name, path: all.slice(0, i + 1).join('/') })) : [];
  });
  readonly marks = computed<GitMark[]>(() => {
    const f = this.changes().files.get(this.active()?.path ?? '');
    return f ? gitMarks(f.patch) : [];
  });

  /** Décalage du curseur dans le texte ; remis au début à chaque changement d'onglet. */
  readonly caret = linkedSignal<string | null, number>({ source: this.activePath, computation: () => 0 });
  /** Ligne à montrer dans l'éditeur (résultat de recherche) ; oubliée au changement d'onglet. */
  readonly goto = linkedSignal<string | null, { line: number; offset: number } | null>({ source: this.activePath, computation: () => null });
  readonly position = computed(() => lineCol(this.text(), Math.min(this.caret(), this.text().length)));
  readonly status = computed(() => {
    const a = this.active();
    if (!a?.body) return null;
    return { lang: languageOf(a.path), lines: lineCount(this.text()), eol: a.body.content.includes('\r\n') ? 'CRLF' : 'LF' };
  });

  /** Aide clavier de l'éditeur (aria-describedby). */
  readonly help = computed(() => (this.editing()
    ? `Tab insère deux espaces, Maj+Tab les retire. Échap puis Tab pour sortir de l’éditeur. ${this.keys.mod}S enregistre.`
    : 'Lecture seule : bouton Éditer pour modifier.'));

  /** Markdown : aperçu mis en forme par défaut, source sur demande (remis à l'aperçu à chaque onglet) ; en édition, toujours la source. */
  readonly showSource = linkedSignal<string | null, boolean>({ source: this.activePath, computation: () => false });
  readonly isMd = computed(() => isMarkdown(this.active()?.path ?? ''));
  readonly markdown = computed(() => {
    const a = this.active();
    return a?.body && this.isMd() && !this.editing() && !this.showSource() ? renderMarkdown(a.body.content) : null;
  });

  /** Ouvre le fichier ; `preview` (clic dans l'arbre) : onglet d'aperçu, remplacé par la prochaine ouverture. */
  async open(path: string, preview = false): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.focused.set(path);
    this.drawer.set(false);
    if (this.tabs().some((t) => t.path === path)) {
      if (!preview) this.pin(path);
      return this.activate(path);
    }
    this.tabs.update((ts) => openTab(ts, path, MAX_TABS, preview));
    this.activePath.set(path);
    this.error.set(null);
    await this.read(id, path);
  }

  /** Résultat de recherche : ouvre le fichier (aperçu), y pose le curseur et fait défiler jusqu'à la ligne. */
  async openAt(path: string, line: number, col: number): Promise<void> {
    await this.open(path, true);
    if (this.activePath() !== path) return; // autre fichier ouvert entre-temps
    // Décalage dans le texte de la <textarea>, qui normalise CRLF en LF.
    const offset = lineOffset(lf(this.text()), line, col);
    this.caret.set(offset);
    this.goto.set({ line, offset });
  }

  /** Passe à l'onglet ; hors édition, le fichier est relu (Claude a pu le modifier). */
  async activate(path: string): Promise<void> {
    const id = this.id(), t = this.tabs().find((x) => x.path === path);
    if (!id || !t || this.activePath() === path) return;
    this.activePath.set(path);
    this.error.set(null);
    if (t.draft === null) await this.read(id, path);
  }

  /** Ferme l'onglet ; une saisie non enregistrée demande confirmation. */
  async close(path: string): Promise<void> {
    const t = this.tabs().find((x) => x.path === path);
    if (!t || (isDirty(t) && !(await this.discard(path)))) return;
    const r = closeTab(this.tabs(), path, this.activePath());
    this.tabs.set(r.tabs);
    if (r.active !== this.activePath() && r.active) await this.activate(r.active);
    else this.activePath.set(r.active);
  }

  /** Garde l'onglet (double-clic, édition) : il n'est plus remplacé par l'aperçu suivant. */
  pin(path: string): void {
    if (this.tabs().find((t) => t.path === path)?.preview) this.setTab(path, { preview: false });
  }

  startEdit(): Promise<void> {
    return this.active()?.body && this.idle() ? this.load() : Promise.resolve();
  }

  /** Relit le fichier depuis le disque et passe en édition (le brouillon de l'onglet est remplacé). */
  async load(): Promise<void> {
    const id = this.id(), path = this.activePath();
    if (!id || !path) return;
    const body = await this.read(id, path);
    if (body) this.setTab(path, { draft: body.content, conflict: false, preview: false });
  }

  edit(text: string): void {
    const path = this.activePath();
    if (path && this.editing()) this.setTab(path, { draft: text });
  }

  async cancelEdit(): Promise<void> {
    const path = this.activePath();
    if (!path || (this.dirty() && !(await this.discard(path)))) return;
    this.setTab(path, { draft: null, conflict: false });
  }

  async save(): Promise<void> {
    const id = this.id(), a = this.active(), body = a?.body;
    if (!id || !a || !body || a.draft === null || !this.idle() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.setTab(a.path, { conflict: false });
    try {
      // `eol` : une <textarea> normalise CRLF en LF ; on remet la fin de ligne du fichier à l'écriture.
      const eol = body.content.includes('\r\n') ? '\r\n' : '\n';
      await this.vigie.writeProjectFile(id, { path: a.path, content: a.draft.replace(/\r?\n/g, eol), hash: body.hash });
      this.setTab(a.path, { draft: null });
      await this.read(id, a.path); // nouvelle empreinte
    } catch (err) {
      if ((err as { status?: number }).status === 412) this.setTab(a.path, { conflict: true }); // 412 = empreinte périmée ; 409 = Claude travaille ; 403 = config Claude
      else this.error.set(message(err));
    }
    this.saving.set(false);
  }

  /**
   * Raccourcis de la vue (⌘/Ctrl + S, P, Maj+F) ; 'quick' : le composant ouvre la fenêtre « Aller au fichier » ;
   * 'search' : la vue Rechercher est affichée, le composant met le focus dans son champ.
   */
  shortcut(e: KeyboardEvent): 'quick' | 'search' | null {
    // Pas de conflit : ⌘F / Ctrl+F (Historique) refuse Maj, et la vue n'existe que quand elle est affichée.
    if (isShortcut(e, 'f', this.mac, true)) {
      e.preventDefault();
      this.showSide('search');
      return 'search';
    }
    if (isShortcut(e, 'p', this.mac)) {
      e.preventDefault();
      return 'quick';
    }
    if (this.active() && isShortcut(e, 's', this.mac)) { e.preventDefault(); void this.save(); }
    // ponytail: pas de ⌘W / Ctrl+W : le navigateur et le menu par défaut d'Electron ferment la fenêtre avant la page
    // (sous Linux, l'app quitte : brouillon perdu). On ferme un onglet par × ou clic milieu ; à rouvrir avec un menu Electron.
    return null;
  }

  private discard(path: string): Promise<boolean> {
    return this.confirm.ask({
      title: 'Abandonner tes modifications ?',
      message: `Ta saisie dans « ${path} » n’est pas enregistrée : elle sera perdue.`,
      action: 'Abandonner',
      danger: true,
    });
  }

  private setTab(path: string, patch: Partial<Tab>): void {
    this.tabs.update((ts) => ts.map((t) => (t.path === path ? { ...t, ...patch } : t)));
  }

  /** Lit le fichier dans son onglet ; ignoré si l'onglet a été fermé ou la session a changé entre-temps. */
  private async read(id: string, path: string): Promise<FileBody | null> {
    const still = () => this.id() === id && this.tabs().some((t) => t.path === path);
    this.loadingFile.set(true);
    let body: FileBody | null;
    try {
      body = await this.vigie.readProjectFile(id, path);
      if (still()) this.setTab(path, { body, error: null });
      this.gitVersion.update((v) => v + 1);
    } catch (e) {
      body = null;
      if (still()) this.setTab(path, { error: message(e) });
    }
    this.loadingFile.set(false);
    return still() ? body : null;
  }
}
