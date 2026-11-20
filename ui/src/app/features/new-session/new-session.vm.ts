import { Injectable, computed, debounced, inject, linkedSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { form, submit, validateStandardSchema } from '@angular/forms/signals';
import * as z from 'zod/mini';
import { Project, ProjectKind } from '../../core/models';
import { CLIENT_OS, isShortcut } from '../../core/platform';
import { VigieService, daemonError } from '../../core/vigie.service';

export type Permission = 'default' | 'acceptEdits' | 'plan';
export type GitMode = 'current' | 'branch' | 'worktree';

export const GIT_MODES = [
  { value: 'current', label: 'Branche courante' },
  { value: 'branch', label: 'Nouvelle branche' },
  { value: 'worktree', label: 'Worktree isolé' },
] as const;

export const TEMPLATES = [
  { id: '', label: 'Aucun', prompt: '' },
  { id: 'feature', label: 'Fonctionnalité et tests', prompt: 'Avant de coder, pose-moi les questions nécessaires pour cadrer la fonctionnalité, puis implémente-la avec ses tests.' },
  { id: 'bug', label: 'Correction de bug', prompt: "Je vais te décrire un bug. Reproduis-le d'abord avec un test qui échoue, puis corrige-le." },
  { id: 'review', label: 'Relecture de la branche', prompt: 'Relis le diff de la branche courante par rapport à la branche principale : bugs, risques, tests manquants.' },
] as const;

export const MODELS = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
] as const;

export const PERMISSIONS = [
  { value: 'default', label: 'Demander à chaque fois' },
  { value: 'acceptEdits', label: 'Accepter les modifications' },
  { value: 'plan', label: "Mode plan d'abord" },
] as const;

/** Libellé affiché par les Select spartan pour une valeur. */
export const labelOf = (list: readonly { value: string; label: string }[]) => (value: string) => list.find((o) => o.value === value)?.label ?? value;

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildCommand(m: { model: string; permission: Permission; git: GitMode; branch?: string; template: string; name?: string }): string {
  const parts = ['claude', '--model', m.model];
  const branch = m.branch?.trim();
  if (m.name?.trim()) parts.push('--name', shQuote(m.name.trim()));
  if (m.permission !== 'default') parts.push('--permission-mode', m.permission);
  if (m.git === 'worktree') parts.push('--worktree', ...(branch ? [shQuote(branch)] : []));
  const prompt = TEMPLATES.find((t) => t.id === m.template)?.prompt;
  if (prompt) parts.push(shQuote(prompt));
  // Branche créée avant claude : si elle existe déjà, git échoue et claude n'est pas lancé.
  return (m.git === 'branch' && branch ? `git switch -c ${shQuote(branch)} && ` : '') + parts.join(' ');
}

export const KIND_LABELS: Record<ProjectKind, string> = { ios: 'iOS', node: 'Node', rust: 'Rust', go: 'Go', python: 'Python', java: 'Java' };

/** Ancienneté : « à l'instant », « il y a 12 min », « il y a 2 h », « il y a 3 j », « il y a 4 mois », « il y a 2 ans ». */
// ponytail: ici plutôt que dans core/format.ts, qui est dans le bundle initial (budget) ; à déplacer au 2e usage.
export function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  const y = Math.floor(d / 365);
  return `il y a ${y} an${y > 1 ? 's' : ''}`;
}

/** Dernier segment d'un chemin (« ~/dev/vigie » → « vigie »). */
export const base = (p: string) => p.slice(p.lastIndexOf('/') + 1) || p;
/** Chemin parent (« ~/dev/vigie » → « ~/dev »). */
export const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/'))) || '/';

/**
 * Indices des lettres de `text` qui correspondent à `q` : sous-chaîne d'abord, sinon lettres dans l'ordre (flou).
 * null si rien ne correspond.
 */
export function fuzzy(text: string, q: string): number[] | null {
  const t = text.toLowerCase(), s = q.toLowerCase();
  const at = t.indexOf(s);
  if (at >= 0) return Array.from(s, (_, k) => at + k);
  const hits: number[] = [];
  for (let k = 0; k < t.length && hits.length < s.length; k++) if (t[k] === s[hits.length]) hits.push(k);
  return hits.length === s.length ? hits : null;
}

/** Rang d'un projet pour `q` : nom exact puis nom flou puis chemin ; null s'il ne correspond pas. */
function rank(p: Project, q: string): number | null {
  const name = base(p.path);
  if (name.toLowerCase().includes(q.toLowerCase())) return 0;
  if (fuzzy(name, q)) return 1;
  return p.path.toLowerCase().includes(q.toLowerCase()) ? 2 : null;
}

/** Pont exposé par l'app de bureau (electron/preload.cjs) ; absent dans un navigateur. */
type DesktopBridge = { pickFolder(from: string): Promise<string | null> };
const desktop = () => (globalThis as { vigieDesktop?: DesktopBridge }).vigieDesktop;

/** Règles du formulaire (pas le corps POST : la commande est composée à partir de ces options). */
const NewSessionForm = z.object({
  name: z.string(),
  cwd: z.string().check(z.minLength(1, 'Choisis un dossier')),
  git: z.enum(['current', 'branch', 'worktree']),
  branch: z.string(),
  model: z.string(),
  permission: z.enum(['default', 'acceptEdits', 'plan']),
  template: z.string(),
}).check(z.refine((m) => m.git !== 'branch' || m.branch !== '', { message: 'Nomme la branche', path: ['branch'] }));

@Injectable()
export class NewSessionVm {
  private readonly vigie = inject(VigieService);
  private readonly router = inject(Router);
  private readonly mac = inject(CLIENT_OS) === 'mac';

  /** Libellé du raccourci de lancement : Cmd sur mac, Ctrl ailleurs (Meta y est la touche Windows/Super). */
  readonly launchKey = this.mac ? '⌘↵' : 'Ctrl+↵';
  readonly templates = TEMPLATES;
  readonly models = MODELS;
  readonly permissions = PERMISSIONS;
  readonly gitModes = GIT_MODES;
  readonly modelLabel = labelOf(MODELS);
  readonly permissionLabel = labelOf(PERMISSIONS);
  readonly model = signal({ name: '', cwd: '', git: 'current' as GitMode, branch: '', model: 'opus', permission: 'default' as Permission, template: '' });
  readonly form = form(this.model, (p) => {
    validateStandardSchema(p, NewSessionForm);
  });

  /** Texte du champ Dossier : recherche dans les récents, ou chemin s'il contient '/'. */
  readonly query = signal('');
  readonly isPath = computed(() => this.query().includes('/'));

  private readonly recentsRes = this.vigie.projectsResource(() => '');
  /** Récents, vides si le daemon ne répond pas ou hors contrat (value() lèverait sur une ressource en erreur). */
  private readonly recents = computed(() => (this.recentsRes.hasValue() ? this.recentsRes.value() : []));
  /** Chemin tapé, débouncé (150 ms) : seul un chemin interroge le daemon, une recherche filtre les récents ici. */
  private readonly pathQuery = debounced(() => (this.isPath() ? this.query() : undefined), (v) => (v === undefined ? undefined : new Promise((r) => setTimeout(r, 150))));
  private readonly browseRes = this.vigie.projectsResource(() => (this.isPath() && this.pathQuery.hasValue() ? this.pathQuery.value() : undefined));

  /** Lignes affichées ; en parcours, garde la liste précédente pendant le chargement (pas de clignotement). */
  readonly rows = linkedSignal<Project[] | null, Project[]>({
    source: () => {
      if (!this.isPath()) {
        const q = this.query().trim();
        if (!q) return this.recents();
        return this.recents().map((p) => ({ p, r: rank(p, q) })).filter((x) => x.r !== null).sort((a, b) => a.r! - b.r!).map((x) => x.p);
      }
      if (this.pathQuery.isLoading() || this.browseRes.isLoading()) return null;
      return this.browseRes.hasValue() ? this.browseRes.value() : [];
    },
    computation: (v, prev) => v ?? prev?.value ?? [],
  });
  /** Ligne active au clavier (aria-activedescendant) ; revient en tête quand la liste change. */
  readonly active = linkedSignal<number>(() => (this.rows().length ? 0 : -1));
  readonly activeId = computed(() => (this.active() >= 0 ? `ns-dir-opt-${this.active()}` : null));

  /** Fil d'Ariane du dossier parcouru : « ~/dev/vigie/u » → ~, dev, vigie. */
  readonly crumbs = computed(() => {
    if (!this.isPath()) return [];
    const q = this.query();
    const segs = q.slice(0, q.lastIndexOf('/')).split('/');
    return segs.map((seg, i) => ({ label: seg || '/', path: segs.slice(0, i + 1).join('/') + '/' }));
  });

  readonly emptyText = computed(() => {
    const q = this.query().trim();
    if (this.isPath()) {
      const seg = base(q.endsWith('/') ? '' : q);
      return `${seg ? `Aucun sous-dossier ne commence par « ${seg} »` : 'Aucun sous-dossier ici'} : le chemin tapé sera utilisé.`;
    }
    return q ? 'Aucun dossier récent ne correspond. Tape un chemin (avec /) pour parcourir le disque.' : 'Aucun dossier récent. Tape un chemin, par exemple ~/dev/mon-projet.';
  });

  /** Recalculée quand une option change, mais reste modifiable à la main. */
  readonly command = linkedSignal(() => buildCommand(this.model()));
  readonly error = signal<string | null>(null);
  /** Dossier le plus récent, utilisé si le champ est laissé vide. */
  readonly defaultDir = computed(() => this.recents()[0]?.path ?? '');
  /** Dossier qui sera utilisé : celui choisi ou tapé, sinon le plus récent. */
  readonly chosen = computed(() => this.model().cwd || this.defaultDir());
  readonly cwdLabel = computed(() => this.chosen() || 'le dossier choisi');

  readonly kindLabel = (k: ProjectKind) => KIND_LABELS[k];
  readonly base = base;
  readonly parent = parent;
  age(ts: number): string {
    return ago(Date.now() - ts);
  }

  /** Nom découpé autour de ce qui est tapé (recherche, ou dernier segment d'un chemin), pour le surligner. */
  parts(name: string): { text: string; hit: boolean }[] {
    const q = this.query().trim();
    const hits = new Set(fuzzy(name, this.isPath() ? q.slice(q.lastIndexOf('/') + 1) : q) ?? []);
    const out: { text: string; hit: boolean }[] = [];
    for (let i = 0; i < name.length; i++) {
      const hit = hits.has(i), last = out.at(-1);
      if (last?.hit === hit) last.text += name[i];
      else out.push({ text: name[i], hit });
    }
    return out;
  }

  /** Le texte tapé est aussi le dossier, tel quel (comme un chemin collé). */
  setQuery(text: string): void {
    this.query.set(text);
    this.setCwd(text);
  }

  setCwd(cwd: string | null | undefined): void {
    this.model.update((m) => ({ ...m, cwd: cwd ?? '' }));
  }

  select(p: Project): void {
    this.setCwd(p.path);
  }

  /** Sélecteur de dossier natif : seulement dans l'app de bureau (un navigateur ne donne pas le chemin absolu). */
  readonly canPick = !!desktop();

  /** Ouvre le sélecteur natif depuis le dossier en cours ; le dossier choisi remplit le champ, comme un chemin tapé. */
  async pickFolder(): Promise<void> {
    // Champ vide : part du dossier qui serait utilisé (le plus récent).
    const q = this.query() || this.chosen();
    const dir = await desktop()?.pickFolder(q.includes('/') ? q.slice(0, q.lastIndexOf('/') + 1) : '');
    if (dir) this.setQuery(dir);
  }

  /** Entre dans le dossier : le champ devient « <chemin>/ » et la liste montre ses sous-dossiers. */
  browse(p: Project): void {
    this.setQuery(`${p.path}/`);
  }

  /** Remonte d'un niveau ; au-dessus de « ~/ », revient aux récents. */
  up(): void {
    const q = this.query().replace(/\/$/, '');
    const i = q.lastIndexOf('/');
    this.setQuery(i < 0 ? '' : q.slice(0, i + 1));
  }

  /** Clavier du champ Dossier : ↑/↓ ligne active, Entrée choisit, Tab/→ parcourt, ←/Retour arrière sur « …/ » remonte. */
  dirKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // Cmd/Ctrl+Entrée : lancement, géré par le formulaire
    const rows = this.rows(), i = this.active(), row = rows[i];
    const el = e.target instanceof HTMLInputElement ? e.target : null;
    const atEnd = !el || (el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!rows.length) return;
        this.active.set((i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
        break;
      case 'Enter':
        if (!row) return;
        this.select(row);
        break;
      case 'Tab':
        // Champ vide : Tab sort du champ normalement (pas de piège au clavier).
        if (e.shiftKey || !row || !this.query()) return;
        this.browse(row);
        break;
      case 'ArrowRight':
        if (!row || !atEnd) return;
        this.browse(row);
        break;
      case 'ArrowLeft':
      case 'Backspace':
        if (!this.query().endsWith('/') || !atEnd) return;
        this.up();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  setGit(git: GitMode): void {
    this.model.update((m) => ({ ...m, git }));
  }

  setTemplate(id: string): void {
    this.model.update((m) => ({ ...m, template: id }));
  }

  setCommand(value: string): void {
    this.command.set(value);
  }

  /** Cmd+Entrée (mac) ou Ctrl+Entrée (ailleurs) lance la session depuis n'importe quel champ. */
  launchOnShortcut(e: KeyboardEvent): void {
    if (!isShortcut(e, 'Enter', this.mac)) return;
    e.preventDefault();
    void this.launch();
  }

  async launch(): Promise<void> {
    if (!this.model().cwd && this.defaultDir()) this.model.update((m) => ({ ...m, cwd: this.defaultDir() }));
    this.error.set(null);
    await submit(this.form, async () => {
      try {
        const term = await this.vigie.startSession({ cwd: this.model().cwd, command: this.command() });
        await this.router.navigate(['/sessions', term.sessionId]);
      } catch (e: unknown) {
        this.error.set(daemonError(e, 'Lancement impossible.'));
      }
      return undefined;
    });
  }
}
