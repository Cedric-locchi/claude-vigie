// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { childDirs, describeDirs, projectKind } from './projects.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

test('projectKind : chaque marqueur, iOS prioritaire sur package.json, null sinon', () => {
  const cas = [
    [['App.xcodeproj'], 'ios'], [['App.xcworkspace'], 'ios'], [['Package.swift'], 'ios'],
    [['package.json'], 'node'], [['Cargo.toml'], 'rust'], [['go.mod'], 'go'],
    [['pyproject.toml'], 'python'], [['requirements.txt'], 'python'], [['setup.py'], 'python'],
    [['pom.xml'], 'java'], [['build.gradle'], 'java'], [['build.gradle.kts'], 'java'],
    [['package.json', 'App.xcodeproj'], 'ios'], [['README.md'], null], [[], null],
  ];
  for (const [names, kind] of cas) assert.equal(projectKind(names), kind, names.join(','));
});

function home() {
  const h = tempDir('vigie-projects-');
  for (const d of ['ios-app', 'Infra', 'web', '.cache']) fs.mkdirSync(path.join(h, 'proj', d), { recursive: true });
  fs.writeFileSync(path.join(h, 'proj', 'fichier'), '');
  return h;
}

test('childDirs : sous-dossiers non cachés filtrés par préfixe (casse ignorée), rien sans séparateur ou hors disque', async () => {
  const h = home();
  const p = (...x) => path.join(h, 'proj', ...x);
  assert.deepEqual((await childDirs(`~${path.sep}proj${path.sep}`, h)).sort(), [p('Infra'), p('ios-app'), p('web')]);
  assert.deepEqual((await childDirs(`~${path.sep}proj${path.sep}i`, h)).sort(), [p('Infra'), p('ios-app')]);
  assert.deepEqual(await childDirs(`~${path.sep}nulle-part${path.sep}x`, h), []);
  assert.deepEqual(await childDirs('proj', h), []);
  assert.deepEqual(await childDirs(`proj${path.sep}`, h), []);
  assert.deepEqual(await childDirs(`~autre${path.sep}`, h), []);
});

test('childDirs : plafond de 50', async () => {
  const h = tempDir('vigie-projects-');
  for (let i = 0; i < 60; i++) fs.mkdirSync(path.join(h, `d${i}`));
  assert.equal((await childDirs(h + path.sep, h)).length, 50);
});

test('describeDirs : type, branche, lastTs de la Map ; dossier disparu → nulls sans faire échouer les autres', async () => {
  const h = home();
  const web = path.join(h, 'proj', 'web');
  fs.writeFileSync(path.join(web, 'package.json'), '{}');
  fs.mkdirSync(path.join(web, '.git'));
  fs.writeFileSync(path.join(web, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const gone = path.join(h, 'disparu');
  assert.deepEqual(await describeDirs([web, gone], new Map([[web, 42]])), [
    { path: web, kind: 'node', branch: 'main', lastTs: 42 },
    { path: gone, kind: null, branch: null, lastTs: null },
  ]);
});
