/** Fonctions pures de l'éditeur de l'onglet Fichiers (gouttière git, position du curseur, indentation). */

/**
 * Marqueur de gouttière, en numéros de ligne du fichier actuel.
 * `del` : des lignes ont disparu juste avant la ligne `from` (= `to`) ; au-delà de la dernière ligne, suppression en fin de fichier.
 */
export interface GitMark { kind: 'add' | 'mod' | 'del'; from: number; to: number; label: string }

const lines = (from: number, to: number, verb: string): string =>
  from === to ? `Ligne ${from} ${verb} depuis le dernier commit` : `Lignes ${from}–${to} ${verb}s depuis le dernier commit`;

/** Patch unifié d'un fichier (GitFile.patch) → marqueurs : un bloc de `-`/`+` contigus devient ajout, modification ou suppression. */
export function gitMarks(patch: string): GitMark[] {
  const marks: GitMark[] = [];
  let n = 0, inHunk = false, adds = 0, dels = 0, start = 0;
  const flush = (): void => {
    if (adds) marks.push({ kind: dels ? 'mod' : 'add', from: start, to: start + adds - 1, label: lines(start, start + adds - 1, dels ? 'modifiée' : 'ajoutée') });
    else if (dels) marks.push({ kind: 'del', from: start, to: start, label: `${dels} ligne${dels > 1 ? 's supprimées' : ' supprimée'} ici depuis le dernier commit` });
    adds = dels = 0;
  };
  for (const l of patch.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) {
      flush();
      // « +4,0 » : aucune ligne côté nouveau fichier, le numéro désigne la ligne d'avant.
      n = +h[1] + (h[2] === '0' ? 1 : 0);
      inHunk = true;
    } else if (!inHunk || l.startsWith('\\')) {
      continue;
    } else if (l[0] === '+' || l[0] === '-') {
      if (!adds && !dels) start = n;
      if (l[0] === '+') { adds++; n++; } else dels++;
    } else if (l[0] === ' ') {
      flush();
      n++;
    }
  }
  flush();
  return marks;
}

/** Position 1-based (ligne, colonne) d'un décalage dans le texte, comme `selectionStart` d'une textarea. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1, lastNl = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) { line++; lastNl = i; }
  return { line, col: offset - lastNl };
}

/** Décalage d'une position 1-based (ligne, colonne), borné à la ligne et au texte : l'inverse de `lineCol`. */
export function lineOffset(text: string, line: number, col: number): number {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) return text.length;
    start = nl + 1;
  }
  const end = text.indexOf('\n', start);
  return Math.min(start + Math.max(0, col - 1), end < 0 ? text.length : end);
}

/** Nombre de lignes affichées (un texte vide ou finissant par un saut de ligne compte sa dernière ligne vide). */
export function lineCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Remplacement à appliquer : `insert` entre `from` et `to`, puis sélection `start`–`end`. */
export interface TextEdit { from: number; to: number; insert: string; start: number; end: number }

export const INDENT = '  ';

/**
 * Tab / Maj+Tab dans l'éditeur. Sans sélection, Tab insère deux espaces au curseur ;
 * avec sélection (ou Maj+Tab), indente ou désindente chaque ligne touchée. null : rien à faire.
 */
export function indent(text: string, start: number, end: number, outdent: boolean): TextEdit | null {
  if (!outdent && start === end) return { from: start, to: start, insert: INDENT, start: start + INDENT.length, end: start + INDENT.length };
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // Sélection qui finit en début de ligne (lignes entières) : la ligne suivante n'est pas touchée.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nl = text.indexOf('\n', last);
  const to = nl < 0 ? text.length : nl;
  let delta = 0, first = 0;
  const out = text.slice(from, to).split('\n').map((l, i) => {
    if (!outdent) { delta += INDENT.length; return INDENT + l; }
    const r = l.startsWith('\t') ? 1 : /^ {0,2}/.exec(l)![0].length;
    if (i === 0) first = r;
    delta -= r;
    return l.slice(r);
  });
  if (!delta) return null;
  const s = outdent ? start - Math.min(first, start - from) : start > from ? start + INDENT.length : start;
  return { from, to, insert: out.join('\n'), start: s, end: start === end ? s : Math.max(s, end + delta) };
}
