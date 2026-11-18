import { describe, expect, it } from 'vitest';
import { pathResolver } from '../touched/files-touched';
import { claudeFile, withFullPath } from './claude-here';

describe('claudeFile', () => {
  const resolve = pathResolver('/dev/meeplebox', ['src/a.ts', 'daemon/usage.mjs', 'README.md']);

  it('Read, Edit, Write, MultiEdit : chemin abrégé de `tool` ou chemin complet de `detail`', () => {
    expect(claudeFile([undefined, 'Read · daemon/usage.mjs'], resolve)).toEqual({ path: 'daemon/usage.mjs', edit: false });
    expect(claudeFile([undefined, 'Edit · meeplebox/README.md'], resolve)).toEqual({ path: 'README.md', edit: true });
    expect(claudeFile(['Write · /dev/meeplebox/src/a.ts', 'Read · daemon/usage.mjs'], resolve)).toEqual({ path: 'src/a.ts', edit: true });
    expect(claudeFile([null, 'MultiEdit · src/a.ts'], resolve)).toEqual({ path: 'src/a.ts', edit: true });
  });

  it('question, commande, motif ou fichier hors projet : source suivante, sinon rien', () => {
    expect(claudeFile(['Quel nom pour la branche ?', 'Read · src/a.ts'], resolve)).toEqual({ path: 'src/a.ts', edit: false });
    expect(claudeFile([undefined, 'Bash · npm test'], resolve)).toBeNull();
    expect(claudeFile([undefined, 'Grep · src/a.ts'], resolve)).toBeNull();
    expect(claudeFile(['Edit · /etc/hosts', null], resolve)).toBeNull();
  });

  it('toolPath remplace la cible abrégée : un autre arbre au même suffixe n\'est plus confondu', () => {
    const tool = 'Edit · src/a.ts';
    expect(claudeFile([undefined, withFullPath(tool, '/dev/ailleurs/src/a.ts')], resolve)).toBeNull();
    expect(claudeFile([undefined, withFullPath(tool, '/dev/meeplebox/src/a.ts')], resolve)).toEqual({ path: 'src/a.ts', edit: true });
    expect(withFullPath(tool, null)).toBe(tool); // daemon plus ancien : libellé abrégé
    expect(withFullPath(undefined, '/x')).toBeUndefined();
  });
});
