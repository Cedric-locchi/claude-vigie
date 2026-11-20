// Décodage tolérant des transcripts Claude Code (~/.claude/projects/<projet>/<session>.jsonl
// et <session>/subagents/agent-<id>.jsonl). Le format n'est pas contractuel : tout champ
// absent ou inattendu est ignoré plutôt que de casser l'ingestion.
import fs from 'node:fs';
import path from 'node:path';

const MIN = 60_000;
/** Segment d'un worktree de Claude Code dans un cwd (`<projet>/.claude/worktrees/<nom>`), séparateur de la plateforme. */
export const WORKTREES = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LS', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Task', 'Agent']);
// Échap dans Claude Code : un message « user » dont le seul bloc texte est ce marqueur (forme relevée dans de vrais transcripts,
// sous-agents compris). Claude Code n'émet pas de hook Stop dans ce cas.
const INTERRUPTED = /^\[Request interrupted by user( for tool use)?\]$/;

export function toolKind(name) {
  if (READ_TOOLS.has(name)) return 'read';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (name === 'Bash') return 'command';
  if (AGENT_TOOLS.has(name)) return 'agent';
  return 'other';
}

function summarize(name, input = {}) {
  const v =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ??
    input.query ?? input.description ?? input.skill ?? input.prompt ?? '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const short = s.startsWith('/') ? s.split('/').slice(-2).join('/') : s;
  return short.replace(/\s+/g, ' ').slice(0, 120);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
}

/** Une "piste" = un fichier JSONL = un agent (principal ou sous-agent). */
export function newTrack(file) {
  return {
    file, offset: 0, rest: '',
    sessionId: null, cwd: null, branch: null, model: null, title: null, firstPrompt: null,
    firstTs: 0, lastTs: 0, lastStop: null, lastText: '',
    interruptTs: 0, // dernier Échap (marqueur INTERRUPTED) : un événement de hook antérieur ne compte plus
    usage: new Map(), // message.id → {ts, model, input, output, cacheCreate, cacheRead}
    prompts: [], // messages de l'humain (début des tours) : {ts, text}
    tools: new Map(), // tool_use_id → {name, kind, label, start, end, error}
    pending: null, // dernier tool_use sans résultat
    lastError: null,
  };
}

export function applyRecord(t, o) {
  if (!o || typeof o !== 'object') return;
  if (o.type === 'ai-title' && !t.title) t.title = o.aiTitle;
  if (o.type === 'custom-title') t.title = o.customTitle;
  if (o.type !== 'user' && o.type !== 'assistant') return;

  const ts = Date.parse(o.timestamp) || 0;
  if (ts) { t.firstTs ||= ts; t.lastTs = Math.max(t.lastTs, ts); }
  t.sessionId ||= o.sessionId;
  if (o.cwd) t.cwd ||= o.cwd; // dossier de lancement : un `cd` en cours de session ne change pas le projet
  if (o.gitBranch) t.branch = o.gitBranch;
  const msg = o.message ?? {};
  const content = Array.isArray(msg.content) ? msg.content : [];

  if (o.type === 'assistant') {
    if (msg.model && msg.model !== '<synthetic>') t.model = msg.model;
    const u = msg.usage;
    // Un message est découpé en plusieurs lignes (une par bloc) qui répètent l'usage : on dédoublonne par id.
    if (u && msg.id) {
      t.usage.set(msg.id, {
        ts, model: msg.model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0,
      });
    }
    if (msg.stop_reason) t.lastStop = msg.stop_reason;
    for (const c of content) {
      if (c?.type === 'text' && c.text?.trim()) t.lastText = c.text.trim();
      if (c?.type === 'tool_use') {
        const tool = { id: c.id, name: c.name, kind: toolKind(c.name), label: summarize(c.name, c.input), start: ts, end: 0, error: false };
        // Chemin complet du fichier visé : le label est raccourci, l'UI doit pouvoir lever l'ambiguïté.
        const file = c.input?.file_path ?? c.input?.notebook_path;
        if (typeof file === 'string' && file) tool.path = file;
        if (c.name === 'AskUserQuestion') tool.question = c.input?.questions?.[0]?.question ?? '';
        t.tools.set(c.id, tool);
        t.pending = tool;
      }
    }
    return;
  }

  // user : soit un prompt humain, soit des résultats d'outils
  let hadResult = false;
  for (const c of content) {
    if (c?.type !== 'tool_result') continue;
    hadResult = true;
    const tool = t.tools.get(c.tool_use_id);
    if (tool) { tool.end = ts; tool.error = !!c.is_error; }
    if (t.pending?.id === c.tool_use_id) t.pending = null;
    t.lastError = c.is_error ? textOf(c.content).slice(0, 200) : null;
  }
  // Interruption : fin de tour (« à toi »), pas un message de l'humain ; l'outil resté sans résultat est clos comme interrompu,
  // et son erreur éventuelle (refus écrit par Claude Code) n'est pas un « souci ». Un prompt tapé porte `promptSource`, jamais
  // le marqueur écrit par Claude Code : le même texte tapé à la main reste un message.
  if (!hadResult && !o.promptSource && INTERRUPTED.test(textOf(msg.content).trim())) {
    if (t.pending) { t.pending.end ||= ts; t.pending.interrupted = true; t.pending = null; }
    t.lastError = null;
    t.lastStop = 'interrupted';
    t.interruptTs = ts;
    return;
  }
  if (!hadResult && !o.isMeta && !o.isSidechain) {
    const text = textOf(msg.content).trim();
    if (text && !text.startsWith('<')) { t.firstPrompt ||= text.slice(0, 200); t.lastStop = null; }
    // Un tour commence à chaque message de l'humain, commandes slash comprises (<command-name>/x</command-name>).
    const command = text.match(/<command-name>([^<]+)<\/command-name>/)?.[1];
    if (text && (!text.startsWith('<') || command)) t.prompts.push({ ts, text: (command ?? text).slice(0, 200) });
  }
  if (!hadResult && o.isSidechain && !t.firstPrompt) t.firstPrompt = textOf(msg.content).slice(0, 200);
}

/**
 * Lit les lignes ajoutées à `cursor.file` depuis `cursor.offset` (lignes partielles gardées dans `cursor.rest`).
 * `onReset` est appelé si le fichier a été réécrit (plus court qu'avant). Renvoie true si quelque chose a été lu.
 */
export function readNewLines(cursor, onRecord, onReset) {
  let fd;
  try {
    const size = fs.statSync(cursor.file).size;
    if (size < cursor.offset) onReset();
    if (size === cursor.offset) return false;
    fd = fs.openSync(cursor.file, 'r');
    const buf = Buffer.alloc(size - cursor.offset);
    fs.readSync(fd, buf, 0, buf.length, cursor.offset);
    cursor.offset = size;
    const lines = (cursor.rest + buf.toString('utf8')).split('\n');
    cursor.rest = lines.pop();
    for (const line of lines) {
      // Les lignes api-request* / file-history* sont énormes et inutiles ici.
      if (!line || line.startsWith('{"type":"api-request') || line.startsWith('{"type":"file-history')) continue;
      try { onRecord(JSON.parse(line)); } catch { /* ligne illisible : ignorée */ }
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Regroupe les événements de `fs.watch` sur `dir` (écouteur rendu) : `flush({ files, full })` part `delay` ms après le premier
 * événement, pas après le dernier (un délai réarmé à chaque écriture repousserait la lecture tant que Claude écrit, lignes à
 * moins de 250 ms d'écart). `files` : chemins absolus des noms reçus entre-temps ; `full` : un événement sans nom, scan complet.
 */
export function batchWatch(dir, flush, delay = 250) {
  let timer = null;
  let files = new Set();
  let full = false;
  return (_event, name) => {
    if (name) files.add(path.join(dir, String(name))); else full = true;
    if (timer) return;
    timer = setTimeout(() => {
      const batch = { files: [...files], full };
      timer = null;
      files = new Set();
      full = false;
      flush(batch);
    }, delay);
  };
}

/** Lit la suite d'un fichier depuis le dernier offset (lignes partielles conservées). */
export function readTrack(t) {
  return readNewLines(t, (o) => applyRecord(t, o), () => Object.assign(t, newTrack(t.file)));
}

// ── Journal ──────────────────────────────────────────────────────────────
const LOG_MAX = 4000;
const SYSTEM_TITLES = {
  stop_hook_summary: 'Hooks de fin de tour', turn_duration: 'Durée du tour', away_summary: 'Résumé d\'absence',
  local_command: 'Commande locale', compact_boundary: 'Compactage du contexte', informational: 'Information',
  api_error: 'Erreur API', agents_killed: 'Agents arrêtés',
};
const NOISE = new Set(['type', 'subtype', 'parentUuid', 'uuid', 'logicalParentUuid', 'sessionId', 'cwd', 'gitBranch', 'version', 'userType', 'entrypoint', 'isSidechain', 'isMeta', 'timestamp', 'slug', 'level']);

/** Détail lisible d'un enregistrement système. */
function systemText(o) {
  if (typeof o.content === 'string' && o.content.trim()) return o.content.trim();
  if (o.subtype === 'turn_duration') return `${Math.round((o.durationMs ?? 0) / 1000)} s, ${o.messageCount ?? '?'} messages`;
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !NOISE.has(k)));
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
}

/**
 * Lignes de journal d'un enregistrement de transcript : prompts, messages, réflexions, appels et résultats
 * d'outils, événements système. `tools` (id → nom) relie un résultat à l'outil qui l'a produit.
 */
export function logEntriesOf(o, tools) {
  const ts = Date.parse(o.timestamp) || 0;
  const out = [];
  const add = (kind, title, text = '', ref) => out.push({
    ts, kind, title, text: text.length > LOG_MAX ? text.slice(0, LOG_MAX) : text, truncated: text.length > LOG_MAX, ...(ref ? { ref } : {}),
  });
  if (o.type === 'system') {
    const failed = o.subtype === 'api_error' || o.level === 'error' || (o.hookErrors?.length ?? 0) > 0;
    add(failed ? 'error' : 'system', SYSTEM_TITLES[o.subtype] ?? o.subtype ?? 'Système', systemText(o));
    return out;
  }
  if (o.type !== 'user' && o.type !== 'assistant') return out;
  const msg = o.message ?? {};
  const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];

  if (o.type === 'assistant') {
    for (const c of content) {
      if (c?.type === 'text' && c.text?.trim()) add(o.isApiErrorMessage ? 'error' : 'assistant', o.isApiErrorMessage ? 'Erreur API' : 'Claude', c.text.trim());
      else if (c?.type === 'thinking' && c.thinking?.trim()) add('thinking', 'Réflexion', c.thinking.trim());
      else if (c?.type === 'tool_use') {
        tools.set(c.id, c.name);
        add('tool', `${c.name} · ${summarize(c.name, c.input)}`, JSON.stringify(c.input ?? {}, null, 2), c.id);
      }
    }
    return out;
  }
  for (const c of content) {
    if (c?.type === 'tool_result') add(c.is_error ? 'error' : 'result', tools.get(c.tool_use_id) ?? 'Résultat', textOf(c.content).trim(), c.tool_use_id);
    else if (c?.type === 'text' && c.text?.trim()) {
      const text = c.text.trim();
      if (o.isMeta || text.startsWith('<')) add('system', 'Système', text);
      else add('prompt', o.isSidechain ? 'Consigne' : 'Toi', text);
    }
  }
  return out;
}

export const tokensOf = (u) => u.input + u.output + u.cacheCreate + u.cacheRead;

export function trackTokens(t) {
  let total = 0, cacheRead = 0, inputSide = 0;
  for (const u of t.usage.values()) {
    total += tokensOf(u);
    cacheRead += u.cacheRead;
    inputSide += u.input + u.cacheCreate + u.cacheRead;
  }
  return { total, cacheRate: inputSide ? cacheRead / inputSide : 0 };
}

export function projectName(cwd) {
  if (!cwd) return '?';
  return path.basename(cwd.split(WORKTREES)[0]);
}

/**
 * État d'un agent : waiting (autorisation/question), running, turn (fin de tour, à toi), done.
 * `live` = dernier événement de hook pour cette session, prioritaire s'il est plus récent que le transcript, sauf s'il précède
 * une interruption (Échap n'émet aucun hook : un PreToolUse d'avant gagnerait sans jamais périmer).
 */
export function deriveState(t, now, live = null) {
  if (live && live.ts >= t.lastTs - 2000 && !(t.interruptTs >= live.ts)) {
    switch (live.event) {
      case 'PermissionRequest': return { state: 'waiting', reason: 'permission', detail: live.detail };
      case 'Notification':
        if (live.kind === 'permission_prompt') return { state: 'waiting', reason: 'permission', detail: live.detail };
        break;
      case 'Stop': return { state: now - live.ts < 30 * MIN ? 'turn' : 'done' };
      case 'SessionEnd': return { state: 'done' };
      case 'UserPromptSubmit': case 'PreToolUse': case 'PostToolUse': case 'SubagentStop':
        return { state: 'running' };
    }
  }
  if (t.pending?.name === 'AskUserQuestion') return { state: 'waiting', reason: 'question', detail: t.pending.question };
  const idle = now - t.lastTs;
  if (t.pending) return { state: idle < 30 * MIN ? 'running' : 'done' };
  // 'interrupted' : valeur interne (applyRecord), jamais dans le contrat.
  if (t.lastStop === 'end_turn' || t.lastStop === 'stop_sequence' || t.lastStop === 'interrupted') return { state: idle < 30 * MIN ? 'turn' : 'done' };
  return { state: idle < 10 * MIN ? 'running' : 'done' };
}
