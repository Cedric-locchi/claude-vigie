/** Fonctions pures de l'onglet Fichiers : ce que Claude a lu ou modifié, d'après la trace de la session. */
import { SessionTrace } from '../../../../core/models';

/** Fichier touché par Claude dans la session (outils `read` / `edit` de la trace, sous-agents compris). */
export interface Touched {
  /** Chemin relatif à la racine du projet. */
  path: string;
  /** Modifié au moins une fois (prime sur « lu »). */
  edited: boolean;
  /** Tour (1-based) et instant de la dernière fois. */
  turn: number;
  at: number;
  /** Nombre d'appels d'outil sur ce fichier. */
  count: number;
  /** Libellé de la trace de la dernière fois : recherche du journal (« Voir dans l'historique »). */
  label: string;
  /** Tour de la dernière modification (null : lu seulement). */
  editTurn: number | null;
}

// ponytail: liste fermée des fichiers système ; en ajouter un = un nom ici.
const SYSTEM = new Set(['.DS_Store', 'Thumbs.db']);
const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Retire les fichiers système (métadonnées du Finder, de l'Explorateur) de la liste du projet. */
export const visibleFiles = (files: string[]): string[] => files.filter((f) => !SYSTEM.has(base(f)));

/**
 * Résout le libellé d'une étape en chemin relatif à `root`, ou null (hors racine, ambigu, inconnu).
 * Le daemon abrège un chemin absolu en ses deux derniers segments (`/…/daemon/usage.mjs` → `daemon/usage.mjs`) :
 * on retrouve le fichier par ce suffixe dans la liste du projet, seulement s'il est unique.
 * La trace donne le chemin complet (`TraceStep.path`) : un fichier hors racine y est écarté. Seul un libellé abrégé (daemon ancien, ou `SessionSummary.tool` en direct)
 * passe par le suffixe.
 * ponytail: « Claude ici » prend `SessionSummary.toolPath` (chemin complet) quand le daemon l'envoie ; sur un daemon plus ancien, un fichier hors racine au suffixe identique à un fichier du projet est pris pour lui via le libellé abrégé. Disparaît avec le repli.
 */
export function pathResolver(root: string, files: string[]): (label: string) => string | null {
  const known = new Set(files), bySuffix = new Map<string, string | null>();
  const rootName = base(root);
  for (const f of files) {
    const parts = f.split('/');
    const key = parts.length > 1 ? parts.slice(-2).join('/') : `${rootName}/${f}`;
    bySuffix.set(key, bySuffix.has(key) ? null : f); // null : suffixe ambigu
  }
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return (label) => {
    const l = label.trim();
    if (l.startsWith('/')) return l.startsWith(prefix) && known.has(l.slice(prefix.length)) ? l.slice(prefix.length) : null;
    const rel = l.replace(/^\.\//, '');
    return known.has(rel) ? rel : (bySuffix.get(rel) ?? null);
  };
}

/** Fichiers lus ou modifiés par Claude, du plus récent au plus ancien. */
export function touchedFiles(trace: SessionTrace | null, root: string, files: string[]): Touched[] {
  if (!trace) return [];
  const resolve = pathResolver(root, files), out = new Map<string, Touched>();
  // Étapes de l'agent principal et de ses sous-agents : une bonne part des modifications passe par eux.
  for (const turn of trace.turns) for (const s of turn.steps.flatMap((x) => [x, ...(x.agent?.steps ?? [])])) {
    if (s.kind !== 'read' && s.kind !== 'edit') continue;
    // Chemin complet quand le daemon le donne (`path`), sinon le libellé raccourci (daemon plus ancien).
    const path = resolve(s.path ?? s.label);
    if (!path) continue;
    const t = out.get(path) ?? { path, edited: false, turn: 0, at: 0, count: 0, label: s.label, editTurn: null };
    t.count++;
    if (s.kind === 'edit') { t.edited = true; t.editTurn = Math.max(t.editTurn ?? 0, turn.index); }
    if (s.start >= t.at) { t.at = s.start; t.turn = turn.index; t.label = s.label; }
    out.set(path, t);
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

/** Fichier à ouvrir d'office quand aucun onglet n'est ouvert : le dernier modifié par Claude. */
export const autoOpen = (touched: Touched[]): string | null => touched.find((t) => t.edited)?.path ?? null;

/** Nombre de fichiers modifiés par Claude sous chaque dossier (marque de l'arbre). */
export function editedDirs(touched: Touched[]): Map<string, number> {
  const dirs = new Map<string, number>();
  for (const t of touched) {
    if (!t.edited) continue;
    for (let i = t.path.lastIndexOf('/'); i > 0; i = t.path.lastIndexOf('/', i - 1)) {
      const d = t.path.slice(0, i);
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
  }
  return dirs;
}
