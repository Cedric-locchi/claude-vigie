// Lancement d'une session claude par Vigie (commande, réglages injectés), en fonctions pures testables sans PTY.
import path from 'node:path';

// ponytail: quotage POSIX ; sous fish (le PTY lance `$SHELL -l -c`), `\'` sort des guillemets et shQuote ne protège plus.
// Le scheme Xcode et les noms de conteneur l'évitent par leur regex, mais `mise run <tâche>` y reste exposé ;
// la suite : lancer les commandes via `/bin/sh -c` plutôt que `$SHELL -c`.
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
 * ponytail: seul le fichier géré local est lu ; une politique distante qui bloque les hooks HTTP couperait l'état temps réel.
 */
export function httpHooksAllowed(managed, url) {
  const list = managed?.allowedHttpHookUrls;
  if (!Array.isArray(list)) return true;
  return list.some((p) => new RegExp(`^${String(p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url));
}

/**
 * Réglages injectés uniquement dans les sessions lancées par Vigie (claude --settings, écrits dans ~/.vigie/hooks.json) :
 * la config globale n'est pas touchée. `node` : commande node déjà prête pour le shell (préfixe d'env et guillemets compris) ;
 * `scriptsDir` : dossier de hook.mjs et statusline.mjs, hors archive asar.
 * `hookUrl` : hooks postés par Claude Code au daemon (aucun process lancé) ; sans lui, repli sur `node hook.mjs` par événement.
 */
export function hooksSettings(node, scriptsDir, hookUrl = null) {
  const hookCmd = hookUrl
    ? { type: 'http', url: hookUrl, timeout: 5 }
    : { type: 'command', command: `${node} ${JSON.stringify(path.join(scriptsDir, 'hook.mjs'))}`, timeout: 5 };
  const withMatcher = [{ matcher: '*', hooks: [hookCmd] }];
  const plain = [{ hooks: [hookCmd] }];
  return {
    statusLine: { type: 'command', command: `${node} ${JSON.stringify(path.join(scriptsDir, 'statusline.mjs'))}` },
    hooks: {
      UserPromptSubmit: plain, PreToolUse: withMatcher, PostToolUse: withMatcher, PermissionRequest: withMatcher,
      Notification: plain, Stop: plain, SubagentStop: plain, SessionEnd: plain,
    },
  };
}
