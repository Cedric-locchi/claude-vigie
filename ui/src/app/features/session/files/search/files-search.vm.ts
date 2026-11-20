import { Injectable, computed, debounced, inject, linkedSignal, resource, signal } from '@angular/core';
import { SearchMatch, SearchResults } from '../../../../core/models';
import { keepLast } from '../../../../core/signals';
import { VigieService, daemonError } from '../../../../core/vigie.service';
import { Row, SessionFilesVm, base, treeKey } from '../session-files.vm';

/** Attente après la dernière frappe avant d'interroger le daemon (ms). */
export const SEARCH_DELAY = 250;
/** Le daemon refuse en dessous (SearchQuery). */
export const SEARCH_MIN = 2;
/** Texte gardé avant le texte trouvé : au-delà, l'extrait commence par « … » pour que le surlignage reste visible. */
const BEFORE = 40;

/** Réponse du daemon avec la requête qui l'a produite : le surlignage suit la réponse affichée, pas la saisie en cours. */
export type Found = SearchResults & { q: string };

/**
 * Ligne de la vue Rechercher : un fichier (niveau 1, repliable) ou un résultat (niveau 2).
 * Mêmes champs que `Row` : les déplacements clavier sont ceux de l'arbre (`treeKey`).
 */
export interface SearchRow extends Row {
  file: string;
  /** Dossier du fichier ('' à la racine), affiché en retrait. */
  dir: string;
  count: number;
  match: SearchMatch | null;
  /** Extrait découpé autour du texte trouvé (résultats seulement). */
  parts?: { pre: string; hit: string; post: string };
}

/** Extrait sans l'indentation, coupé avant le texte trouvé s'il est loin ; `hit` : `text.slice(at, at + n)`. */
export function parts(m: SearchMatch, n: number): { pre: string; hit: string; post: string } {
  const pre = m.text.slice(0, m.at).trimStart();
  return { pre: pre.length > BEFORE ? '…' + pre.slice(-BEFORE) : pre, hit: m.text.slice(m.at, m.at + n), post: m.text.slice(m.at + n) };
}

/** Résultats → lignes affichées ; un fichier replié ne montre que son en-tête. */
export function searchRows(found: Found, collapsed: Set<string>): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const f of found.files) {
    const open = !collapsed.has(f.path), dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')));
    rows.push({ path: f.path, name: base(f.path), depth: 0, kind: 'dir', open, file: f.path, dir, count: f.matches.length, match: null });
    if (open) for (const m of f.matches) {
      rows.push({ path: `${f.path}#${m.line}`, name: '', depth: 1, kind: 'file', open: false, file: f.path, dir, count: 0, match: m, parts: parts(m, found.q.length) });
    }
  }
  return rows;
}

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Vue Rechercher de l'onglet Fichiers : texte littéral dans le contenu des fichiers du projet.
 * Fournie par l'onglet (pas par la vue) : saisie et résultats survivent au passage par une autre vue du panneau.
 */
@Injectable()
export class FilesSearchVm {
  private readonly vigie = inject(VigieService);
  private readonly files = inject(SessionFilesVm);

  readonly query = signal('');
  readonly matchCase = signal(false);

  /** Requête envoyée SEARCH_DELAY ms après la dernière frappe ; undefined (moins de SEARCH_MIN caractères) : tout de suite, sans requête. */
  private readonly term = debounced(
    () => {
      const id = this.files.id(), q = this.query();
      return id && q.length >= SEARCH_MIN ? { id, q, matchCase: this.matchCase() } : undefined;
    },
    (v) => (v === undefined ? undefined : new Promise<void>((r) => setTimeout(r, SEARCH_DELAY))),
    { equal: (a, b) => a?.id === b?.id && a?.q === b?.q && a?.matchCase === b?.matchCase },
  );
  // Nouvelle requête : resource() annule le chargement en cours (abortSignal coupe la requête HTTP) et ignore sa réponse.
  private readonly res = resource({
    params: () => (this.term.hasValue() ? this.term.value() : undefined),
    loader: ({ params: p, abortSignal }) => this.vigie.searchFiles(p.id, p.q, p.matchCase, abortSignal).then((r): Found => ({ ...r, q: p.q })),
  });
  /** Derniers résultats, gardés pendant la recherche suivante (pas de clignotement à chaque frappe). */
  private readonly kept = keepLast(this.res, () => this.files.id());
  private readonly short = computed(() => this.query().length < SEARCH_MIN);
  readonly pending = computed(() => !this.short() && (this.term.isLoading() || this.res.isLoading()));
  readonly error = computed(() => (!this.short() && this.res.status() === 'error' ? daemonError(this.res.error(), 'Recherche impossible.') : null));
  /** Résultats affichés : aucun sous SEARCH_MIN caractères ni en erreur. */
  readonly found = computed(() => (this.short() || this.error() ? null : this.kept()));

  /** Fichiers repliés ; tout se déplie à chaque nouvelle réponse. */
  readonly collapsed = linkedSignal<Found | null, Set<string>>({ source: this.found, computation: () => new Set() });
  readonly rows = computed(() => { const f = this.found(); return f ? searchRows(f, this.collapsed()) : []; });

  /** Résumé sous le champ ; `err` : message du daemon (400, daemon muet ou hors contrat). */
  readonly summary = computed<{ text: string; err?: boolean } | null>(() => {
    const q = this.query();
    if (!q) return null;
    if (this.short()) return { text: `Tape au moins ${SEARCH_MIN} caractères.` };
    if (this.pending()) return { text: 'Recherche…' };
    const e = this.error();
    if (e) return { text: e, err: true };
    const f = this.found();
    if (!f) return null;
    if (!f.files.length) return { text: 'Aucun résultat' };
    const n = f.files.reduce((s, x) => s + x.matches.length, 0);
    return { text: `${plural(n, 'résultat')} dans ${plural(f.files.length, 'fichier')}` };
  });
  readonly truncated = computed(() => !!this.found()?.truncated);

  toggleCase(): void { this.matchCase.update((v) => !v); }

  /** Ligne qui porte le tabindex (roving tabindex) : la dernière focalisée, sinon la première. */
  private readonly focused = signal<string | null>(null);
  readonly focusRow = computed(() => {
    const rows = this.rows(), f = this.focused();
    return rows.some((r) => r.path === f) ? f : (rows[0]?.path ?? null);
  });

  toggle(file: string): void {
    this.collapsed.update((s) => {
      const next = new Set(s);
      if (!next.delete(file)) next.add(file);
      return next;
    });
  }

  /** Clic : un fichier se replie ou se déplie, un résultat ouvre le fichier à sa ligne. */
  pick(r: SearchRow): Promise<void> {
    this.focused.set(r.path);
    if (!r.match) { this.toggle(r.file); return Promise.resolve(); }
    return this.files.openAt(r.file, r.match.line, r.match.col);
  }

  /** Touche dans la liste ; true si elle est prise en charge (le composant déplace alors le focus sur `focusRow`). */
  key(key: string): boolean {
    const rows = this.rows();
    const move = treeKey(rows, rows.findIndex((r) => r.path === this.focusRow()), key);
    if (!move) return false;
    if (move.toggle) this.toggle(move.toggle);
    const open = move.open && rows.find((r) => r.path === move.open);
    if (open) void this.pick(open);
    this.focused.set(rows[move.focus].path);
    return true;
  }
}
