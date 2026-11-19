// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { API, tempDir } from '../daemon/plugins.mjs';
import { check, render, withUi } from './plugin-uis.mjs';

test('withUi : manifeste valide avec ui/index.ts seulement ; render : trié, chemins en /, sortie stable', () => {
  const root = tempDir('vigie-plugin-uis-');
  const plugin = (id, vigie, ui) => {
    fs.mkdirSync(path.join(root, id, 'ui'), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'package.json'), JSON.stringify({ vigie }));
    if (ui) fs.writeFileSync(path.join(root, id, 'ui', 'index.ts'), '');
  };
  plugin('zeta', { api: API, id: 'zeta' }, true);
  plugin('alpha-b', { api: API, id: 'alpha-b' }, true);
  plugin('back-seul', { api: API, id: 'back-seul' }, false); // pas encore de front : absent
  plugin('vieux', { api: 1, id: 'vieux' }, true); // manifeste en erreur : absent
  const ids = withUi(root);
  assert.deepEqual(ids.sort(), ['alpha-b', 'zeta']);
  const text = render(ids, path.join(root, '..', 'ui', 'src'), root);
  const base = path.basename(root);
  assert.equal(text, `// Généré par scripts/plugin-uis.mjs : ne pas éditer.
import type { Type } from '@angular/core';
export const PLUGIN_UIS: Readonly<Record<string, () => Promise<{ default: Type<unknown> }>>> = {
  'alpha-b': () => import('../../${base}/alpha-b/ui/index'),
  zeta: () => import('../../${base}/zeta/ui/index'),
};
`);
  assert.equal(render(['zeta', 'alpha-b'], path.join(root, '..', 'ui', 'src'), root), text);
  assert.match(render([]), /= \{\n\};\n$/);
});

test('check : OK, table périmée, double Angular depuis plugins/<id>/ui (résolution réelle de node_modules)', () => {
  const angular = (at) => {
    const d = path.join(at, 'node_modules', '@angular', 'core');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: '@angular/core', main: 'index.js' }));
    fs.writeFileSync(path.join(d, 'index.js'), '');
  };
  // Dépôt neuf à chaque cas : Node garde en cache les résolutions d'un même chemin.
  const repo = ({ stale = false, double = false } = {}) => {
    const root = tempDir('vigie-plugin-uis-check-');
    const dir = path.join(root, 'plugins'), uiDir = path.join(root, 'ui'), file = path.join(uiDir, 'src', 'gen.ts');
    fs.mkdirSync(path.join(dir, 'x', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'x', 'package.json'), JSON.stringify({ vigie: { api: API, id: 'x' } }));
    fs.writeFileSync(path.join(dir, 'x', 'ui', 'index.ts'), '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, render(stale ? [] : ['x'], path.dirname(file), dir));
    angular(root); // la copie de la racine
    if (double) angular(path.join(dir, 'x')); // `npm install` lancé dans plugins/x
    return { dir, file, uiDir };
  };
  assert.deepEqual(check(repo()), []);
  const stale = check(repo({ stale: true }));
  assert.equal(stale.length, 1);
  assert.match(stale[0], /n'est pas à jour/);
  const opts = repo({ double: true });
  const errors = check(opts);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Deux copies de @angular\/core/);
  assert.ok(errors[0].includes(path.join(opts.dir, 'x', 'node_modules')), errors[0]);
  // Dépendances pas installées : rien à comparer.
  assert.deepEqual(check({ ...opts, resolve: () => null }), []);
});
