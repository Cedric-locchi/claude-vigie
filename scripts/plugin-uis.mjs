#!/usr/bin/env node
// Table des fronts de plugins (décision 037) : écrit ui/src/app/core/plugin-uis.generated.ts, un import paresseux par plugin
// qui a un plugins/<id>/ui/index.ts. Outil de build (ni daemon ni UI) : lancé par les scripts pre* de ui/ ; `--check` (en tête
// de `npm test`) sort en 1 si le fichier versionné n'est plus à jour, ou si @angular/core se résout à deux copies.
// Mêmes règles d'id et d'api que le daemon : readManifests. Un manifeste en erreur ou sans ui/index.ts est absent de la table.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifests } from '../daemon/plugins.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pluginsDir = path.join(root, 'plugins');
const out = path.join(root, 'ui', 'src', 'app', 'core', 'plugin-uis.generated.ts');

/** Contenu de la table (pur) : entrées triées par id, chemins d'import relatifs au fichier généré, toujours en `/`. */
export function render(ids, from = path.dirname(out), dir = pluginsDir) {
  const lines = [...ids].sort().map((id) => {
    const spec = path.relative(from, path.join(dir, id, 'ui', 'index')).split(path.sep).join('/');
    const key = /^[a-z_$][\w$]*$/i.test(id) ? id : `'${id}'`;
    return `  ${key}: () => import('${spec}'),\n`;
  });
  return `// Généré par scripts/plugin-uis.mjs : ne pas éditer.
import type { Type } from '@angular/core';
export const PLUGIN_UIS: Readonly<Record<string, () => Promise<{ default: Type<unknown> }>>> = {
${lines.join('')}};
`;
}

/** Ids des plugins dont le manifeste est valide et qui ont un front. */
export const withUi = (dir) => readManifests(dir).filter((m) => !m.error && fs.statSync(path.join(dir, m.id, 'ui', 'index.ts'), { throwIfNoEntry: false })?.isFile()).map((m) => m.id);

/** Fichier où `@angular/core` se résout depuis `dir`, null si introuvable (dépendances pas installées). */
export const angularFrom = (dir) => { try { return createRequire(path.join(dir, 'x.js')).resolve('@angular/core'); } catch { return null; } };

/**
 * Problèmes vus par `--check` (liste vide = OK) : table `file` périmée ; @angular/core résolu ailleurs que depuis `uiDir`,
 * depuis plugins/ ou depuis un plugins/<id>/ui (un `npm install` lancé dans ui/ ou dans un plugin : deux copies d'Angular,
 * l'injection de dépendances d'un plugin casserait, NG0203). `resolve` injectable pour les tests.
 */
export function check({ dir = pluginsDir, file = out, uiDir = path.join(root, 'ui'), resolve = angularFrom } = {}) {
  const errors = [];
  const ids = withUi(dir);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== render(ids, path.dirname(file), dir)) errors.push(`${path.relative(root, file)} n'est pas à jour : lance \`node scripts/plugin-uis.mjs\` et commite-le.`);
  const ui = resolve(uiDir);
  for (const from of [dir, ...ids.map((id) => path.join(dir, id, 'ui'))]) {
    const other = resolve(from);
    if (ui && other && other !== ui) errors.push(`Deux copies de @angular/core (${ui} et ${other}, vue depuis ${path.relative(root, from)}) : supprime le node_modules en trop et relance \`npm install\` à la racine.`);
  }
  return errors;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const errors = check();
    for (const e of errors) console.error(e);
    process.exit(errors.length ? 1 : 0);
  }
  const text = render(withUi(pluginsDir));
  // Écrit seulement si le contenu change : pas de rebuild inutile de `ng serve` / `ng build --watch`.
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text);
}
