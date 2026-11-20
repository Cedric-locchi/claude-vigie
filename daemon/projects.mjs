// Sélecteur de projet : dossiers proposés au lancement d'une session, avec leur type (marqueurs à la racine) et leur branche.
// Lecture seule, sans process : une readdir et la lecture de .git/HEAD par dossier.
import fs from 'node:fs';
import path from 'node:path';
import { headBranch } from './git.mjs';
import { expandHome, tildePath } from './paths.mjs';

const MAX_CHILDREN = 50;

/** Type de projet d'après les noms à la racine ; le premier marqueur de la liste gagne (une app iOS a souvent un package.json). */
export function projectKind(names) {
  const has = (...n) => n.some((x) => names.includes(x));
  if (names.some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace')) || has('Package.swift')) return 'ios';
  if (has('package.json')) return 'node';
  if (has('Cargo.toml')) return 'rust';
  if (has('go.mod')) return 'go';
  if (has('pyproject.toml', 'requirements.txt', 'setup.py')) return 'python';
  if (has('pom.xml', 'build.gradle', 'build.gradle.kts')) return 'java';
  return null;
}

/**
 * Sous-dossiers (non cachés) du chemin tapé, qui commencent par son dernier segment : un projet sans transcript récent
 * (Claude Code efface les anciens) reste proposé. Rien tant que le texte n'est pas un chemin ; dossier illisible → [].
 */
export async function childDirs(q, home) {
  if (!q.includes(path.sep)) return [];
  const abs = expandHome(q, home);
  if (!path.isAbsolute(abs)) return []; // relatif : se résoudrait contre le cwd du daemon (`/` sous launchd)
  const [parent, prefix] = abs.endsWith(path.sep) ? [abs, ''] : [path.dirname(abs), path.basename(abs).toLowerCase()];
  let entries;
  try { entries = await fs.promises.readdir(parent, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name.toLowerCase().startsWith(prefix))
    .slice(0, MAX_CHILDREN)
    .map((d) => path.join(parent, d.name));
}

/** Dossiers → `{ path, kind, branch, lastTs }` (chemins absolus). Un dossier illisible a kind et branch à null, sans faire échouer les autres. */
export function describeDirs(dirs, lastTsMap) {
  return Promise.all(dirs.map(async (d) => {
    const lastTs = lastTsMap.get(d) ?? null;
    try {
      const [names, branch] = await Promise.all([fs.promises.readdir(d), headBranch(d)]);
      return { path: d, kind: projectKind(names), branch, lastTs };
    } catch { return { path: d, kind: null, branch: null, lastTs }; }
  }));
}

/**
 * Choix du sélecteur (GET /api/projects?q=) : chemin tapé (contient un séparateur) → ses sous-dossiers, sinon les dossiers
 * récents (`recent` : store.recentDirs()) ; chemins rendus en `~/…`.
 */
export async function listProjects(q, home, recent) {
  const dirs = q.includes(path.sep) ? await childDirs(q, home) : recent.map((r) => r.dir);
  const projects = await describeDirs(dirs, new Map(recent.map((r) => [r.dir, r.lastTs])));
  return projects.map((p) => ({ ...p, path: tildePath(p.path, home) }));
}
