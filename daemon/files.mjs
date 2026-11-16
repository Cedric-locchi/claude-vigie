// Fichiers du projet d'une session (onglet Fichiers) : arbre, lecture et édition de n'importe quel fichier texte, ignorés
// par git compris (.env…), à la demande de l'utilisateur. Racine = racine du dépôt, sinon le cwd résolu.
// Les gardes de lecture/écriture sont celles de l'onglet Diff (git.checkFile, git.replaceFile) ; seule l'appartenance change.
import fs from 'node:fs';
import path from 'node:path';
import { checkFile, fail, git, repoRoot, replaceFile, sha256 } from './git.mjs';

const MAX_TREE = 20_000;
// Dossiers repliés hors dépôt : énormes et sans intérêt à parcourir ; listés sans leur contenu.
const SKIP = new Set(['node_modules', '.git']);

/** Coupe la liste à `max` entrées (dossiers repliés d'abord) et signale la coupe. */
function cap(root, repo, files, collapsed, max) {
  const truncated = files.length + collapsed.length > max;
  if (truncated) { collapsed = collapsed.slice(0, max); files = files.slice(0, max - collapsed.length); }
  return { root, repo, files, collapsed, truncated };
}

/** Arbre du projet : liste plate, chemins relatifs à la racine ; dossiers ignorés / node_modules / .git repliés (`collapsed`, sans `/` final). */
export async function listProjectFiles(cwd, max = MAX_TREE) {
  const root = await repoRoot(cwd);
  if (root) {
    const [listed, ignored] = await Promise.all([
      git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
      // --directory : un dossier entièrement ignoré sort en une entrée `dir/` (node_modules, dist…) au lieu de son contenu.
      git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']),
    ]);
    // Set : un fichier en conflit apparaît une fois par étape d'index.
    const files = new Set(), collapsed = new Set();
    for (const p of (listed + ignored).split('\0')) {
      if (!p) continue;
      // `dir/` : dossier ignoré, ou dépôt imbriqué non suivi.
      if (p.endsWith('/')) collapsed.add(p.slice(0, -1)); else files.add(p);
    }
    return cap(root, true, [...files], [...collapsed], max);
  }
  const real = await fs.promises.realpath(cwd);
  const files = [], collapsed = [];
  // Parcours en largeur : à la coupe, on garde le haut de l'arbre.
  const queue = [''];
  while (queue.length && files.length + collapsed.length <= max) {
    const dir = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(path.join(real, dir), { withFileTypes: true }); } catch { continue; } // illisible : ignoré
    for (const d of entries) {
      const p = dir ? path.join(dir, d.name) : d.name;
      // Liens symboliques ni suivis ni listés : un lien sortant ferait parcourir (et éditer) hors du projet.
      if (d.isDirectory()) (SKIP.has(d.name) ? collapsed.push(p) : queue.push(p));
      else if (d.isFile()) files.push(p);
    }
  }
  return cap(real, false, files, collapsed, max);
}

/**
 * Garde d'appartenance (remplace « présent dans git status » de l'onglet Diff) : chemin relatif qui ne remonte pas
 * et ne touche pas `.git` (config, hooks : exécutables par git). `checkFile` vérifie ensuite le realpath sous la racine.
 */
async function projectFile(cwd, rel) {
  if (path.isAbsolute(rel) || rel.includes('\0')) throw fail('chemin invalide');
  const n = path.normalize(rel);
  if (n === '..' || n.startsWith('..' + path.sep)) throw fail('fichier hors du projet');
  // toLowerCase : `.GIT` désigne le même dossier sur un système de fichiers insensible à la casse (macOS).
  if (n.split(path.sep).some((s) => s.toLowerCase() === '.git')) throw fail('dossier .git en lecture seule');
  const root = (await repoRoot(cwd)) ?? await fs.promises.realpath(cwd);
  return checkFile(root, n);
}

/** Contenu d'un fichier du projet et son empreinte (sha256 des octets), à renvoyer avec l'écriture. */
export async function readProjectFile(cwd, rel) {
  const { content, buf } = await projectFile(cwd, rel);
  return { path: rel, content, hash: sha256(buf) };
}

/** Remplace un fichier du projet (empreinte vérifiée, 412 ; jamais sous `<home>/.claude`, 403). */
export function writeProjectFile(cwd, rel, content, hash, home) {
  return replaceFile(() => projectFile(cwd, rel), content, hash, home);
}
