import { describe, expect, it } from 'vitest';
import { SessionTrace, TraceStep } from '../../../../core/models';
import { autoOpen, editedDirs, pathResolver, touchedFiles, visibleFiles } from './files-touched';

const FILES = ['daemon/usage.mjs', 'daemon/store.mjs', 'contract/index.mjs', 'README.md', 'ui/src/index.ts', 'pkg/src/index.ts'];
const step = (kind: TraceStep['kind'], label: string, start: number): TraceStep & { agent: null } =>
  ({ id: `${kind}${start}`, name: kind === 'edit' ? 'Edit' : 'Read', kind, label, start, end: start + 1, error: false, interrupted: false, agent: null });
const aTrace = (turns: (TraceStep & { agent: null })[][]): SessionTrace => ({
  now: 10_000, state: 'turn', waiting: null,
  turns: turns.map((steps, i) => ({ index: i + 1, start: 0, end: 0, prompt: '', live: false, steps })),
});

describe('pathResolver', () => {
  const resolve = pathResolver('/dev/vigie', FILES);
  it('chemin absolu sous la racine, relatif, ./', () => {
    expect(resolve('/dev/vigie/daemon/usage.mjs')).toBe('daemon/usage.mjs');
    expect(resolve('contract/index.mjs')).toBe('contract/index.mjs');
    expect(resolve('./README.md')).toBe('README.md');
  });
  it('libellé abrégé du daemon (deux derniers segments), fichier à la racine compris', () => {
    expect(resolve('daemon/store.mjs')).toBe('daemon/store.mjs');
    expect(resolve('vigie/README.md')).toBe('README.md');
  });
  it('hors racine, ambigu ou inconnu : null', () => {
    expect(resolve('/etc/hosts')).toBeNull();
    expect(resolve('/dev/vigie-old/README.md')).toBeNull();
    expect(resolve('src/index.ts')).toBeNull(); // ui/src/index.ts et pkg/src/index.ts
    expect(resolve('**/*.ts')).toBeNull(); // Glob
  });
});

describe('touchedFiles', () => {
  it('modifié prime sur lu, dernier tour et compte, du plus récent au plus ancien ; ignore le reste', () => {
    const trace = aTrace([
      [step('read', 'daemon/usage.mjs', 1), step('read', 'contract/index.mjs', 2), step('command', 'npm test', 3)],
      [step('edit', 'daemon/usage.mjs', 5), step('read', 'daemon/usage.mjs', 6), step('read', '/etc/hosts', 7)],
    ]);
    expect(touchedFiles(trace, '/dev/vigie', FILES)).toEqual([
      { path: 'daemon/usage.mjs', edited: true, turn: 2, at: 6, count: 3, label: 'daemon/usage.mjs', editTurn: 2 },
      { path: 'contract/index.mjs', edited: false, turn: 1, at: 2, count: 1, label: 'contract/index.mjs', editTurn: null },
    ]);
    expect(touchedFiles(null, '/dev/vigie', FILES)).toEqual([]);
  });

  it('ouverture d’office : le dernier modifié, sinon rien', () => {
    const t = touchedFiles(aTrace([[step('edit', 'daemon/store.mjs', 1), step('read', 'README.md', 2)]]), '/dev/vigie', FILES);
    expect(autoOpen(t)).toBe('daemon/store.mjs');
    expect(autoOpen(t.filter((x) => !x.edited))).toBeNull();
  });

  it('compte les fichiers modifiés par dossier', () => {
    const t = touchedFiles(aTrace([[step('edit', 'daemon/store.mjs', 1), step('edit', 'daemon/usage.mjs', 2), step('edit', 'ui/src/index.ts', 3), step('read', 'contract/index.mjs', 4)]]), '/dev/vigie', FILES);
    expect(Object.fromEntries(editedDirs(t))).toEqual({ daemon: 2, ui: 1, 'ui/src': 1 });
  });
});

describe('visibleFiles', () => {
  it('masque les fichiers système, à tous les niveaux', () => {
    expect(visibleFiles(['.DS_Store', 'a/.DS_Store', 'b/Thumbs.db', '.env', 'DS_Store.md'])).toEqual(['.env', 'DS_Store.md']);
  });
});

describe('touchedFiles avec chemin complet', () => {
  it('lève l’ambiguïté d’un libellé raccourci grâce à `path`', () => {
    const files = ['a/src/index.ts', 'b/src/index.ts'];
    const step = { id: '1', name: 'Edit', kind: 'edit' as const, label: 'src/index.ts', path: '/r/b/src/index.ts', start: 1, end: 2, error: false, interrupted: false, agent: null };
    const trace = { now: 3, state: 'turn' as const, waiting: null, turns: [{ index: 1, start: 0, end: 3, prompt: '', live: false, steps: [step] }] };
    expect(touchedFiles(trace, '/r', files).map((t) => t.path)).toEqual(['b/src/index.ts']);
    expect(touchedFiles({ ...trace, turns: [{ ...trace.turns[0], steps: [{ ...step, path: undefined }] }] }, '/r', files)).toEqual([]);
  });
});
