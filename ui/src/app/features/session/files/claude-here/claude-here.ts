/** Fonction pure de « Claude ici » : le fichier que Claude lit ou modifie en ce moment, d'après le résumé de la session. */

// Outils qui visent un seul fichier (`file_path` / `notebook_path`) ; Glob et Grep visent un motif, pas un fichier.
const READ = new Set(['Read', 'NotebookRead']);
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Fichier touché en ce moment ; `edit` : modification (lilas), sinon lecture (ardoise). */
export interface Here { path: string; edit: boolean }

/**
 * Première source qui désigne un fichier du projet. Le daemon écrit `« Outil · cible »` :
 * - `SessionSummary.tool` : dernier outil de l'agent principal, cible abrégée à deux segments (`daemon/usage.mjs`) ;
 * - `SessionSummary.detail` : seulement en attente (`Edit · /chemin/complet`, 120 caractères au plus) ou le texte d'une question.
 * `resolve` ramène la cible à un chemin relatif du projet (null : hors projet, ambigu ou coupé).
 */
export function claudeFile(sources: readonly (string | null | undefined)[], resolve: (label: string) => string | null): Here | null {
  for (const s of sources) {
    const i = s?.indexOf(' · ') ?? -1;
    if (!s || i < 0) continue;
    const name = s.slice(0, i), edit = EDIT.has(name);
    if (!edit && !READ.has(name)) continue;
    const path = resolve(s.slice(i + 3));
    if (path) return { path, edit };
  }
  return null;
}
