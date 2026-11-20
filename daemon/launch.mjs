// Lancement d'une session claude par Vigie (commande, réglages injectés) et logique des scripts lancés par Claude Code
// (hook.mjs, statusline.mjs), en fonctions pures testables sans PTY. `node:path` et paths.mjs seulement : les scripts l'importent.
import path from 'node:path';
import { expandHome } from './paths.mjs';

// ponytail: quotage POSIX ; sous fish (le PTY lance `$SHELL -l -c`) l'apostrophe passe (`'\''` y est valide) mais pas l'antislash :
// fish lit `\\` et `\'` comme des échappements même entre guillemets simples. Les terminaux des plugins n'y sont pas exposés :
// `terminal()` du SDK (plugins.mjs) refuse tout argument avec un antislash (une tâche mise qui en contient ne se lance donc pas) ;
// la suite, pour lever ce refus : `/bin/sh -c` plutôt que `$SHELL -c`.
export const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// `claude` en tête, ou après un `&&` (ex. `git switch -c x && claude …`).
const CLAUDE = /(^|&&\s*)claude(?=\s|$)/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Fixe l'id de session et branche les hooks (`--settings`) : c'est ce qui relie le PTY à son transcript.
 * `newId` : générateur d'id (crypto.randomUUID), injecté pour les tests.
 */
export function claudeCommand(command, hooksFile, newId) {
  const cmd = String(command ?? 'claude').trim() || 'claude';
  const m = cmd.match(CLAUDE);
  // Options cherchées seulement après le `claude` trouvé : le `-c` de `git switch -c x && claude` n'est pas un --continue.
  const args = m ? cmd.slice(m.index + m[0].length) : '';
  // `claude --resume <uuid>` reprend le transcript existant : on garde son id (claude refuse --session-id sans --fork-session).
  const resumed = args.match(new RegExp(`\\s(?:--resume|-r)[\\s=]+(${UUID})(?=\\s|$)`, 'i'))?.[1];
  const sessionId = resumed ?? newId();
  // --continue / --resume sans id : id inconnu d'avance, on force un fork vers notre id.
  const fork = !resumed && /\s(?:--resume|-r|--continue|-c)(?=[\s=]|$)/.test(args) ? ' --fork-session' : '';
  const idFlag = resumed ? '' : ` --session-id ${sessionId}${fork}`;
  return { sessionId, command: cmd.replace(CLAUDE, `$1claude${idFlag} --settings ${shQuote(hooksFile)}`) };
}

/** Ligne du spool tirée d'un événement de hook : seuls les champs utiles, jamais le contenu des fichiers ni les sorties d'outils. */
// Champs texte coupés : l'UI n'en montre que le début, et une ligne courte part en un seul write (O_APPEND : pas d'entrelacement).
const cut = (s) => (typeof s === 'string' && s.length > 2000 ? s.slice(0, 2000) : s);

export function spoolLine(e, ts = Date.now()) {
  const i = e.tool_input;
  return {
    ts,
    session_id: e.session_id,
    hook_event_name: e.hook_event_name,
    tool_name: e.tool_name,
    tool_input: i && { command: cut(i.command), file_path: cut(i.file_path), url: cut(i.url), pattern: cut(i.pattern), description: cut(i.description) },
    notification_type: e.notification_type,
    message: cut(e.message),
  };
}

/**
 * Hooks HTTP permis ? Non si des réglages gérés posent `allowedHttpHookUrls` sans motif qui couvre `url` (`*` = joker).
 * ponytail: seul le fichier géré local est lu. Sans effet aujourd'hui : les hooks HTTP sont coupés (server.mjs), les hooks sont des
 * commandes ; à revoir (politique distante) le jour où on les réactive.
 */
export function httpHooksAllowed(managed, url) {
  const list = managed?.allowedHttpHookUrls;
  if (!Array.isArray(list)) return true;
  return list.some((p) => new RegExp(`^${String(p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url));
}

/**
 * Commande node des scripts lancés par Claude Code (statusline à chaque rafraîchissement, hooks), prête pour le shell.
 * Hors Electron : le node qui fait tourner le daemon (`execOk` : son fichier existe encore), sinon celui du PATH (nvm, mise, brew
 * l'ont changé). Dans Electron, `execPath` est le binaire de l'app, lourd à démarrer à chaque fois : node du PATH d'abord, sinon
 * Electron en mode node (`vigieNode` : binaire de l'app passé par Electron, l'utilityProcess ayant pour execPath le « Helper »).
 * `pathNode()` : node du PATH assez récent, ou null (appelé seulement si besoin : il lance `node --version`).
 */
export function nodeCommand({ electron, execPath, execOk, vigieNode, pathNode }) {
  if (!electron) return shQuote(execOk ? execPath : (pathNode() ?? execPath));
  const found = pathNode();
  return found ? shQuote(found) : 'ELECTRON_RUN_AS_NODE=1 ' + shQuote(vigieNode || execPath);
}

/**
 * Réglages injectés uniquement dans les sessions lancées par Vigie (claude --settings, écrits dans ~/.vigie/hooks.json) :
 * la config globale n'est pas touchée. `node` : commande node déjà prête pour le shell (`nodeCommand`) ;
 * `scriptsDir` : dossier de hook.mjs et statusline.mjs, hors archive asar (quoté par shQuote : ni `$` ni backtick développés).
 * Par défaut (`hookUrl` null, décision 021) : un `node hook.mjs` par événement. `hookUrl` : hooks HTTP postés au daemon,
 * coupés aujourd'hui (le proxy du sandbox de Claude Code les refuse), gardés pour les réactiver.
 */
export function hooksSettings(node, scriptsDir, hookUrl = null) {
  const hookCmd = hookUrl
    ? { type: 'http', url: hookUrl, timeout: 5 }
    : { type: 'command', command: `${node} ${shQuote(path.join(scriptsDir, 'hook.mjs'))}`, timeout: 5 };
  const withMatcher = [{ matcher: '*', hooks: [hookCmd] }];
  const plain = [{ hooks: [hookCmd] }];
  return {
    statusLine: { type: 'command', command: `${node} ${shQuote(path.join(scriptsDir, 'statusline.mjs'))}` },
    hooks: {
      UserPromptSubmit: plain, PreToolUse: withMatcher, PostToolUse: withMatcher, PermissionRequest: withMatcher,
      Notification: plain, Stop: plain, SubagentStop: plain, SessionEnd: plain,
    },
  };
}

/** Statusline habituelle de l'utilisateur (réglages de Claude Code), `~/` développé ; null s'il n'en a pas. */
export function userStatusLine(settings, home) {
  const cmd = settings?.statusLine?.command;
  return typeof cmd === 'string' && cmd.trim() ? expandHome(cmd, home) : null;
}

/**
 * Relevé que la statusline garde pour Vigie (quota `rate_limits`, taille du contexte `context_window`) : `{ name, data }`,
 * `name` = fichier de `~/.vigie/limits/` (id de session sans rien d'autre que `[\w-]`) ; null si l'entrée n'a ni l'un ni l'autre.
 */
export function limitsReading(e, ts) {
  if (!e || typeof e !== 'object' || !(e.rate_limits || e.context_window)) return null;
  const id = String(e.session_id ?? '').replace(/[^\w-]/g, '') || 'inconnue';
  return { name: `${id}.json`, data: { ts, rate_limits: e.rate_limits, context_window: e.context_window } };
}
