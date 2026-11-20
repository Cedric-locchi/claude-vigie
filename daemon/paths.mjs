// Chemins partagés (daemon, scripts lancés par Claude Code, CLI, Electron), en fonctions pures : `~` dans les deux sens,
// dossier de config de Claude Code. `node:path` seulement : statusline.mjs l'importe depuis app.asar.unpacked/daemon.
import path from 'node:path';

/** `~` ou `~/…` → chemin sous `home` (le reste, séparateur final compris, est gardé tel quel) ; tout autre texte inchangé (`~autre` aussi). */
export const expandHome = (p, home) => (p === '~' || p.startsWith('~' + path.sep) ? home + p.slice(1) : p);

/** Chemin sous `home` → `~/…` ; `home` lui-même → `~`. Séparateur exigé : `/Users/x2` n'est pas sous `/Users/x`. */
export const tildePath = (p, home) => (p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p);

/** Dossier de config de Claude Code : `CLAUDE_CONFIG_DIR` s'il est défini (résolu), sinon `~/.claude`. */
export const claudeConfigDir = ({ env = {}, home }) => (env.CLAUDE_CONFIG_DIR ? path.resolve(expandHome(env.CLAUDE_CONFIG_DIR, home)) : path.join(home, '.claude'));

/**
 * Fichier d'état global de Claude Code (compte, MCP, projets) : `$CLAUDE_CONFIG_DIR/.claude.json` si la variable est définie
 * (Claude le range alors dans ce dossier), sinon `~/.claude.json`.
 */
export const claudeJsonFile = ({ env = {}, home }) => path.join(env.CLAUDE_CONFIG_DIR ? claudeConfigDir({ env, home }) : home, '.claude.json');

/**
 * Config globale de Claude Code, que Vigie n'écrit jamais : `~/.claude`, `~/.claude.json` (compte, MCP, état) et le
 * dossier `CLAUDE_CONFIG_DIR` s'il est défini (qui contient alors `claudeJsonFile`). Les deux chemins du home restent
 * protégés même avec `CLAUDE_CONFIG_DIR` : un Claude lancé sans la variable les utilise.
 */
export const claudeConfigPaths = ({ env = {}, home }) => [...new Set([path.join(home, '.claude'), path.join(home, '.claude.json'), claudeConfigDir({ env, home })])];

/** `p` est `dir` ou se trouve dessous (chemins déjà résolus). */
export function isInside(p, dir) {
  const rel = path.relative(dir, p);
  return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}
