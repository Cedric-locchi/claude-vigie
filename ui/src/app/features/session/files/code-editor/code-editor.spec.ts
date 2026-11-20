import { describe, expect, it } from 'vitest';
import { FIND_MAX, findAll, findParts, gitMarks, indent, lineCol, lineCount, lineOffset } from './code-editor';

const apply = (text: string, e: NonNullable<ReturnType<typeof indent>>) => text.slice(0, e.from) + e.insert + text.slice(e.to);

describe('gitMarks', () => {
  it('ajout, modification et suppression, numérotés dans le fichier actuel', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts',
      '@@ -1,6 +1,7 @@',
      ' un',
      '+nouveau', // ligne 2 ajoutée
      ' deux',
      '-trois',
      '+TROIS', // ligne 4 modifiée
      '+trois bis', // ligne 5 modifiée
      ' quatre',
      '-cinq', // supprimée avant la ligne 7
      ' six',
      '\\ No newline at end of file',
    ].join('\n');
    expect(gitMarks(patch).map(({ kind, from, to }) => [kind, from, to])).toEqual([['add', 2, 2], ['mod', 4, 5], ['del', 7, 7]]);
    expect(gitMarks(patch).map((m) => m.label)).toEqual([
      'Ligne 2 ajoutée depuis le dernier commit',
      'Lignes 4–5 modifiées depuis le dernier commit',
      '1 ligne supprimée ici depuis le dernier commit',
    ]);
  });

  it('plusieurs hunks ; « +n,0 » (suppression sans contexte) vise la ligne suivante', () => {
    const patch = '@@ -10,2 +10,0 @@\n-a\n-b\n@@ -40 +38,2 @@\n-x\n+y\n+z';
    expect(gitMarks(patch).map(({ kind, from, to }) => [kind, from, to])).toEqual([['del', 11, 11], ['mod', 38, 39]]);
  });

  it('fichier non suivi : tout est ajouté ; patch vide ou binaire : rien', () => {
    expect(gitMarks('@@ -0,0 +1,3 @@\n+a\n+b\n+c').map(({ kind, from, to }) => [kind, from, to])).toEqual([['add', 1, 3]]);
    expect(gitMarks('')).toEqual([]);
    expect(gitMarks('Binary files a/x.png and b/x.png differ')).toEqual([]);
  });
});

describe('lineCol / lineCount', () => {
  it('ligne et colonne 1-based depuis selectionStart', () => {
    const t = 'ab\ncde\n\nf';
    expect(lineCol(t, 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol(t, 2)).toEqual({ line: 1, col: 3 });
    expect(lineCol(t, 3)).toEqual({ line: 2, col: 1 });
    expect(lineCol(t, 7)).toEqual({ line: 3, col: 1 });
    expect(lineCol(t, t.length)).toEqual({ line: 4, col: 2 });
    // Inverse, borné à la ligne puis au texte.
    for (const o of [0, 2, 3, 7, t.length]) { const p = lineCol(t, o); expect(lineOffset(t, p.line, p.col)).toBe(o); }
    expect(lineOffset(t, 2, 99)).toBe(6);
    expect(lineOffset(t, 99, 1)).toBe(t.length);
  });
  it('compte la dernière ligne vide', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('a\nb')).toBe(2);
    expect(lineCount('a\nb\n')).toBe(3);
  });
});

describe('indent', () => {
  it('Tab sans sélection : deux espaces au curseur', () => {
    const e = indent('ab', 1, 1, false)!;
    expect(apply('ab', e)).toBe('a  b');
    expect([e.start, e.end]).toEqual([3, 3]);
  });

  it('Tab sur une sélection : indente chaque ligne touchée, garde la sélection', () => {
    const t = 'un\ndeux\ntrois';
    const e = indent(t, 1, 5, false)!; // de « n » de un à « e » de deux
    expect(apply(t, e)).toBe('  un\n  deux\ntrois');
    expect([e.start, e.end]).toEqual([3, 9]);
  });

  it('lignes entières (fin de sélection en début de ligne) : la ligne suivante est épargnée', () => {
    const t = 'un\ndeux\ntrois';
    const e = indent(t, 0, 8, false)!;
    expect(apply(t, e)).toBe('  un\n  deux\ntrois');
    expect([e.start, e.end]).toEqual([0, 12]);
  });

  it('Maj+Tab retire jusqu’à deux espaces ou une tabulation par ligne', () => {
    const t = '    a\n\tb\n c\nd';
    const e = indent(t, 0, t.length, true)!;
    expect(apply(t, e)).toBe('  a\nb\nc\nd');
    expect(indent('abc', 1, 1, true)).toBeNull(); // rien à retirer
    const c = indent('  abc', 4, 4, true)!; // curseur seul
    expect(apply('  abc', c)).toBe('abc');
    expect([c.start, c.end]).toEqual([2, 2]);
  });
});

describe('findAll', () => {
  it('texte littéral, insensible à la casse sauf matchCase', () => {
    expect(findAll('Export export EXPORT', 'export', false)).toEqual([{ from: 0, to: 6 }, { from: 7, to: 13 }, { from: 14, to: 20 }]);
    expect(findAll('Export export EXPORT', 'export', true)).toEqual([{ from: 7, to: 13 }]);
    expect(findAll('a.b axb (x) x', 'a.b', false)).toEqual([{ from: 0, to: 3 }]); // pas une expression régulière
    expect(findAll('a.b axb (x) x', '(x)', false)).toEqual([{ from: 8, to: 11 }]);
    expect(findAll('$1 \\d [a]', '\\d', false)).toEqual([{ from: 3, to: 5 }]);
  });

  it('sans chevauchement, rien pour une saisie vide, plafonné', () => {
    expect(findAll('aaa', 'aa', false)).toEqual([{ from: 0, to: 2 }]);
    expect(findAll('abc', '', false)).toEqual([]);
    expect(findAll('x'.repeat(FIND_MAX + 5), 'x', false)).toHaveLength(FIND_MAX);
    expect(findAll('x'.repeat(10), 'x', false, 3)).toHaveLength(3);
  });

  it('Unicode : accents et casse, emoji', () => {
    expect(findAll('Été, été, ETE', 'été', false)).toEqual([{ from: 0, to: 3 }, { from: 5, to: 8 }]);
    expect(findAll('a 😀 b 😀', '😀', true)).toEqual([{ from: 2, to: 4 }, { from: 7, to: 9 }]);
  });
});

describe('findParts', () => {
  it('découpe autour des occurrences, la courante marquée ; la concaténation redonne le texte', () => {
    const text = 'un deux un trois un';
    const parts = findParts(text, findAll(text, 'un', false), 1);
    expect(parts).toEqual([
      { text: 'un', hit: true, cur: false }, { text: ' deux ', hit: false, cur: false }, { text: 'un', hit: true, cur: true },
      { text: ' trois ', hit: false, cur: false }, { text: 'un', hit: true, cur: false },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(findParts('abc', [], -1)).toEqual([{ text: 'abc', hit: false, cur: false }]);
  });
});
