// Store en mémoire : reconstruit au démarrage depuis les transcripts, puis tenu à jour en incrémental.
// ponytail: pas de base de données, tout est relu au démarrage (~quelques secondes pour 14 jours).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  newTrack, readTrack, trackTokens, projectName, deriveState, readNewLines, logEntriesOf,
} from './ingest.mjs';
import { openHistory, writeHistory } from './history.mjs';
import { costOf } from './pricing.mjs';
import { buildTrace } from './trace.mjs';
import {
  DAY, HISTORY_DAYS, RETENTION_DAYS, toMs, usageSummary, usageRows, groupRows, mergeRows, mergeWindows, quotaBlocks,
  sessionUsage, quotaWindow, costSeries,
} from './usage.mjs';

const ACTIVITY_MIN = 15;
/** Premier démarrage sans historique : on relit un mois de transcripts pour l'amorcer. */
const SEED_DAYS = 31;
// Aucun texte d'une discussion n'est écrit dans l'historique (elle est effacée de ~/.claude en la quittant).
const CHAT_META = { title: '(discussion)', project: 'discussion' };

/**
 * `projectsDir` : transcripts de Claude Code (~/.claude/projects) ; `hiddenFile` : sessions supprimées de Vigie ;
 * `chatDir` : dossier des discussions (sessions jetables, cf. CLAUDE.md) ; null = aucune discussion, rien n'est jamais
 * considéré comme tel (isChat faux, purgeChats sans effet) ; `limitsDir` : relevés de la statusline ;
 * `historyFile` : historique de consommation (~/.vigie/usage.json, écrit par saveHistory) ; null = pas de persistance.
 */
export function createStore({ projectsDir, hiddenFile = path.join(os.homedir(), '.vigie', 'hidden.json'), chatDir = null, limitsDir = LIMITS_DIR, historyFile = null }) {
  const tracks = new Map(); // fichier → piste
  const live = new Map(); // sessionId → dernier événement de hook
  // Dossier de session (transcript sans .jsonl) → pistes de ses sous-agents : évite de parcourir toutes les pistes à chaque résumé.
  const subsByDir = new Map();
  // Sessions supprimées de Vigie : sessionId → date de suppression. Le transcript de Claude n'est pas touché.
  let hidden = {};
  try { hidden = JSON.parse(fs.readFileSync(hiddenFile, 'utf8')); } catch { /* aucune */ }

  function hide(sessionId) {
    hidden[sessionId] = Date.now();
    try { fs.writeFileSync(hiddenFile, JSON.stringify(hidden)); } catch { /* reste masquée jusqu'au redémarrage */ }
  }
  // Une session supprimée qui reprend de l'activité (claude --resume) réapparaît.
  const isHidden = (s) => hidden[s.id] && s.lastTs <= hidden[s.id];

  // ── Historique de consommation (décision 025) ───────────────────────────
  // Lu une fois ici (cf. history.mjs), réécrit par saveHistory.
  let { history, seed, canWrite } = openHistory(historyFile);
  // Rien de neuf depuis le dernier enregistrement (scan sans changement, aucune purge) : saveHistory ne réécrit pas le fichier.
  let dirty = true;
  let savedAt = 0;
  // Début des événements fiables en mémoire (fixé au premier scan) : avant, un transcript non relu peut manquer.
  let horizon = null;
  // Plus haut % réel vu par fenêtre (clé : fin) : la statusline écrase son relevé à chaque fenêtre, on garde le pic pour l'historique.
  const peaks = new Map();

  function scan() {
    const days = horizon === null && seed ? SEED_DAYS : HISTORY_DAYS;
    const since = Date.now() - days * DAY;
    horizon ??= since;
    let changed = false;
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir); } catch { return false; }
    for (const d of dirs) {
      const dir = path.join(projectsDir, d);
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const files = [];
        if (e.isFile() && e.name.endsWith('.jsonl')) files.push(path.join(dir, e.name));
        if (e.isDirectory()) {
          const sub = path.join(dir, e.name, 'subagents');
          try { for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(path.join(sub, f)); } catch { /* pas de sous-agents */ }
        }
        for (const f of files) {
          let st;
          try { st = fs.statSync(f); } catch { continue; }
          if (st.mtimeMs < since) continue;
          let t = tracks.get(f);
          if (!t) {
            t = newTrack(f);
            tracks.set(f, t);
            if (isSub(t)) {
              const k = path.dirname(path.dirname(f)); // <session>/subagents/x.jsonl → <session> = sessionDir(principale)
              if (!subsByDir.has(k)) subsByDir.set(k, []);
              subsByDir.get(k).push(t);
            }
          }
          if (readTrack(t)) changed = dirty = true;
        }
      }
    }
    // Transcript disparu : Claude Code le déplace en quittant un worktree (enregistrement `relocated`), on le relit
    // sous son nouveau chemin. Garder l'ancienne piste ferait apparaître la session deux fois.
    const gone = [...tracks.keys()].filter((f) => !fs.existsSync(f));
    if (gone.length) {
      saveHistory(); // un transcript vraiment effacé garde ainsi sa consommation
      for (const f of gone) forget(f);
      changed = dirty = true;
    }
    return changed;
  }

  /** Oublie une piste (mémoire seulement, rien n'est effacé du disque). */
  function forget(f) {
    const t = tracks.get(f);
    if (!t) return;
    if (isSub(t)) {
      const k = path.dirname(path.dirname(f));
      const rest = (subsByDir.get(k) ?? []).filter((s) => s !== t);
      if (rest.length) subsByDir.set(k, rest); else subsByDir.delete(k);
    }
    tracks.delete(f);
    logs.delete(f);
  }

  function onHook(e) {
    // SubagentStop arrive après le Stop du tour principal : il ne dit rien de l'état de la session.
    if (!e?.session_id || e.hook_event_name === 'SubagentStop') return;
    const detail = e.tool_name ? `${e.tool_name} · ${toolDetail(e.tool_input)}` : (e.message ?? '');
    live.set(e.session_id, { event: e.hook_event_name, kind: e.notification_type, ts: e.ts ?? Date.now(), detail });
  }

  const isSub = (t) => t.file.includes(`${path.sep}subagents${path.sep}`);
  const sessionDir = (t) => t.file.replace(/\.jsonl$/, '');

  /** Efface une session du disque (transcript + dossier des sous-agents) et de la mémoire : réservé aux discussions. */
  /** `save` : enregistre d'abord l'historique (sa consommation y reste, sans titre : CHAT_META) ; faux quand l'appelant vient de le faire. */
  function purge(sessionId, { save = true } = {}) {
    if (save) saveHistory();
    for (const [f, t] of [...tracks]) {
      const mine = isSub(t) ? f.includes(`${path.sep}${sessionId}${path.sep}`) : path.basename(f, '.jsonl') === sessionId;
      if (!mine) continue;
      if (!isSub(t)) {
        fs.rmSync(f, { force: true });
        fs.rmSync(sessionDir(t), { recursive: true, force: true });
      }
      // Même clé pour la principale et ses sous-agents (utile si seule la piste d'un sous-agent est connue).
      subsByDir.delete(isSub(t) ? path.dirname(path.dirname(f)) : sessionDir(t));
      tracks.delete(f);
      logs.delete(f);
      dirty = true;
    }
    live.delete(sessionId);
  }

  const subagentsOf = (main) => subsByDir.get(sessionDir(main)) ?? [];

  /**
   * Garde-fou avant d'effacer une session du disque : vrai seulement si c'est une discussion. Tous les transcripts qui
   * portent cet id font foi (purge les efface tous, quel que soit le projet) ; sans transcript (discussion en attente),
   * un de ses terminaux (shell compris) dans chatDir suffit. Toutes les pistes : une discussion sans date reste supprimable.
   */
  function isChat(id, terminals) {
    if (!chatDir) return false;
    const mains = [...tracks.values()].filter((t) => !isSub(t) && path.basename(t.file, '.jsonl') === id);
    // Un transcript existant décide seul : un terminal dans chatDir ne doit pas faire effacer un vrai transcript.
    if (mains.length) return mains.every((t) => t.cwd === chatDir);
    return terminals.some((t) => t.sessionId === id && t.cwd === chatDir);
  }

  /** Aucune discussion ne survit à un redémarrage (app quittée sans en sortir) : efface les restes. */
  function purgeChats() {
    if (!chatDir) return;
    // server.mjs enregistre l'historique juste avant : inutile de réécrire le fichier à chaque discussion.
    for (const t of [...tracks.values()].filter((x) => !isSub(x) && x.cwd === chatDir)) purge(path.basename(t.file, '.jsonl'), { save: false });
  }

  /** Dossier d'une session : son transcript, sinon le terminal claude qui l'a lancée (transcript pas encore écrit). */
  function cwdOf(id, terminals) {
    const main = mains().find((t) => t.sessionId === id);
    return main ? main.cwd : terminals.find((t) => t.kind === 'claude' && t.sessionId === id)?.cwd ?? null;
  }

  /**
   * Dossiers récents (sous-agents compris), du plus récent au plus ancien, sans discussion ni worktree, encore existants :
   * `[{ dir, lastTs }]`, `lastTs` = dernière activité dans ce dossier (null si aucun horodatage).
   */
  function recentDirs(limit = 30) {
    const last = new Map(); // tri décroissant : la première piste vue d'un dossier porte son max
    for (const t of [...tracks.values()].filter((t) => t.cwd && t.cwd !== chatDir && !t.cwd.includes('/.claude/worktrees/')).sort((a, b) => b.lastTs - a.lastTs)) {
      if (!last.has(t.cwd)) last.set(t.cwd, t.lastTs || null);
    }
    return [...last].filter(([d]) => fs.existsSync(d)).slice(0, limit).map(([dir, lastTs]) => ({ dir, lastTs }));
  }

  function readMeta(t) {
    try { return JSON.parse(fs.readFileSync(t.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { return {}; }
  }

  // Un sous-agent terminé ne change plus : son meta est gardé en mémoire, les autres sont relus.
  // ponytail: un meta qui repasserait de finished:true à false n'est plus relu ; invalider sur mtime si ça arrive.
  function metaOf(t) {
    if (t.meta?.finished) return t.meta;
    return (t.meta = readMeta(t));
  }

  /** État de la session principale : hook le plus récent, sinon transcript ; terminal claude fermé = terminée. */
  function stateOf(main, now, terminals) {
    const term = terminals.find((x) => x.sessionId === main.sessionId && x.kind === 'claude');
    const st = deriveState(main, now, live.get(main.sessionId));
    return term?.exited && st.state !== 'done' ? { state: 'done' } : st;
  }

  // État d'abord : le meta n'est lu que pour les sous-agents en cours.
  const activeSubs = (subs, now) => subs.filter((s) => deriveState(s, now).state === 'running' && !metaOf(s).finished);

  /**
   * Claude ne touche pas au dossier : tour rendu ou terminé, sans sous-agent en cours. Garde l'écriture d'un fichier
   * depuis Vigie (sinon Claude et l'utilisateur s'écrasent mutuellement). Session sans transcript : comme pendingSummary.
   */
  function idle(id, terminals) {
    const main = mains().find((t) => t.sessionId === id);
    const now = Date.now();
    if (!main) return terminals.some((t) => t.kind === 'claude' && t.sessionId === id);
    return ['turn', 'done'].includes(stateOf(main, now, terminals).state) && !activeSubs(subagentsOf(main), now).length;
  }

  function summary(main, now, terminals) {
    const subs = subagentsOf(main);
    const { total } = trackTokens(main);
    const subTokens = subs.reduce((n, s) => n + trackTokens(s).total, 0);
    const term = terminals.find((x) => x.sessionId === main.sessionId && x.kind === 'claude');
    const st = stateOf(main, now, terminals);
    const tool = main.pending ?? [...main.tools.values()].at(-1);
    return {
      id: main.sessionId,
      project: projectName(main.cwd),
      cwd: main.cwd,
      branch: main.branch,
      model: main.model,
      title: main.title ?? main.firstPrompt ?? '(sans titre)',
      lastText: main.lastText.slice(0, 280),
      tool: tool ? `${tool.name} · ${tool.label}` : null,
      ...st,
      detail: st.detail ?? (st.state === 'waiting' && tool ? `${tool.name} · ${tool.label}` : undefined),
      subagents: subs.length,
      activeSubagents: activeSubs(subs, now).length,
      tokens: total + subTokens,
      cost: [main, ...subs].reduce((n, t) => n + [...t.usage.values()].reduce((m, u) => m + costOf(u), 0), 0),
      activity: activityOf([main, ...subs], now),
      firstTs: main.firstTs,
      lastTs: Math.max(main.lastTs, ...subs.map((s) => s.lastTs)),
      terminalId: term?.id ?? null,
    };
  }

  /** Appels API + lancements d'outils par minute sur le dernier quart d'heure (le plus ancien d'abord) : ça avance ou c'est bloqué. */
  function activityOf(list, now) {
    const buckets = new Array(ACTIVITY_MIN).fill(0);
    const add = (ts) => { const i = ACTIVITY_MIN - 1 - Math.floor((now - ts) / 60_000); if (i >= 0 && i < ACTIVITY_MIN) buckets[i]++; };
    for (const t of list) {
      if (now - t.lastTs > ACTIVITY_MIN * 60_000) continue;
      for (const u of t.usage.values()) add(u.ts);
      for (const x of t.tools.values()) add(x.start);
    }
    return buckets;
  }

  function mains() {
    return [...tracks.values()].filter((t) => !isSub(t) && t.sessionId && t.firstTs);
  }

  // Session lancée par Vigie : Claude n'écrit son transcript qu'au premier message.
  function pendingSummary(term, now) {
    return {
      id: term.sessionId, project: projectName(term.cwd), cwd: term.cwd, branch: null, model: null,
      title: 'Nouvelle session', lastText: '', tool: null, state: term.exited ? 'done' : 'turn',
      subagents: 0, activeSubagents: 0, tokens: 0, cost: 0, activity: new Array(ACTIVITY_MIN).fill(0), firstTs: term.startedAt ?? now, lastTs: term.startedAt ?? now, terminalId: term.id,
    };
  }

  function snapshot(terminals) {
    const now = Date.now();
    const known = mains();
    const ids = new Set(known.map((t) => t.sessionId));
    // Filtre avant le résumé (coûteux) : même règle qu'avant, terminal claude ouvert ou activité (sous-agents compris) de moins d'un jour.
    const sessions = known
      .filter((t) => terminals.some((x) => x.sessionId === t.sessionId && x.kind === 'claude') || now - Math.max(t.lastTs, ...subagentsOf(t).map((s) => s.lastTs)) < DAY)
      .map((t) => summary(t, now, terminals))
      .concat(terminals.filter((t) => t.kind === 'claude' && !ids.has(t.sessionId)).map((t) => pendingSummary(t, now)))
      .filter((s) => !isHidden(s))
      .sort((a, b) => b.lastTs - a.lastTs);
    const open = readings(now).filter((r) => r.end > now);
    return { now, sessions, usage: usageSummary(tracks.values(), now, open.length ? quotaWindow(open, now) : null), terminals };
  }

  /** Relevés de la statusline (cf. readReadings), en retenant au passage le pic de chaque fenêtre. */
  function readings(now) {
    const list = readReadings(now, limitsDir);
    for (const r of list) if (!(peaks.get(r.end)?.pct >= r.pct)) peaks.set(r.end, { end: r.end, pct: r.pct });
    // Au-delà, saveHistory (toutes les 10 min) a déjà archivé le pic avec sa fenêtre.
    for (const end of peaks.keys()) if (now - end > 2 * DAY) peaks.delete(end);
    return list;
  }

  const groups = () => mains().map((m) => ({ main: m, subs: subagentsOf(m), ...(chatDir && m.cwd === chatDir ? CHAT_META : {}) }));

  /** Fenêtres de 5 h closes, calculées sur les événements en mémoire depuis `horizon`. */
  function liveWindows(now) {
    if (horizon === null) return [];
    const events = [];
    for (const t of tracks.values()) for (const u of t.usage.values()) if (u.ts >= horizon) events.push(u);
    readings(now);
    return quotaBlocks(events, [...peaks.values()], now);
  }

  const windowsAt = (now) => mergeWindows(history.windows, liveWindows(now), horizon ?? now);

  /**
   * Lignes de consommation des `days` derniers jours (cf. usage.mjs), historique compris, et fenêtres de 5 h closes de la période.
   * Servies à part pour ne pas alourdir le snapshot.
   */
  function rows(now = Date.now(), days = HISTORY_DAYS) {
    const r = usageRows(groups(), now, days, history.rows);
    return { ...r, windows: windowsAt(now).filter((w) => w.end > r.since) };
  }

  /** Écrit l'historique (tmp + rename, jamais de fichier tronqué). Ne lève jamais : un échec est journalisé, on réessaiera. */
  function saveHistory(now = Date.now()) {
    // Au moins une fois par heure même sans changement : une fenêtre de 5 h se clôt avec le temps, et son pic (peaks) est oublié après 2 jours.
    if (!canWrite || (!dirty && now - savedAt < 3_600_000)) return;
    try {
      history = {
        rows: mergeRows(history.rows, groupRows(groups(), true), now),
        windows: windowsAt(now).filter((w) => w.end >= now - RETENTION_DAYS * DAY),
      };
      writeHistory(historyFile, history);
      dirty = false;
      savedAt = now;
    } catch (e) { console.error(`[vigie] historique non enregistré : ${e.message}`); }
  }

  /** Coût de la session au fil du temps, par agent (cf. usage.costSeries) ; null si inconnue. */
  function sessionCost(sessionId) {
    const main = mains().find((t) => t.sessionId === sessionId);
    return main ? costSeries([main, ...subagentsOf(main)]) : null;
  }

  function detail(sessionId, terminals) {
    const main = mains().find((t) => t.sessionId === sessionId);
    const now = Date.now();
    if (!main) {
      const term = terminals.find((t) => t.kind === 'claude' && t.sessionId === sessionId);
      if (!term) return null;
      const empty = newTrack();
      const u = sessionUsage(empty, []);
      u.contextMax = contextMax(empty.sessionId, empty.model, limitsDir, u.context);
      return { summary: pendingSummary(term, now), agents: [], timeline: { start: now, end: now }, usage: u };
    }
    const subs = subagentsOf(main);
    // Le tool_use parent (Task/Agent) porte la description et la date de lancement du sous-agent.
    const agents = [
      agentOf(main, 'Agent principal', null, now, live.get(sessionId)),
      ...subs.map((s) => {
        const meta = metaOf(s);
        const parent = meta.toolUseId ? main.tools.get(meta.toolUseId) : null;
        return agentOf(s, meta.agentType ?? 'sous-agent', meta, now, null, parent);
      }),
    ];
    const start = Math.min(...agents.map((a) => a.firstTs).filter(Boolean));
    const end = Math.max(now, ...agents.map((a) => a.lastTs));
    const u = sessionUsage(main, subs);
    u.contextMax = contextMax(main.sessionId, main.model, limitsDir, u.context); // en dernier : ordre des clés JSON inchangé
    return { summary: summary(main, now, terminals), agents, timeline: { start, end }, usage: u };
  }

  function agentOf(t, name, meta, now, lv, parent) {
    let st = deriveState(t, now, lv);
    if (meta?.finished) st = { state: 'done' };
    // "Souci" : l'agent s'est arrêté sur une erreur d'outil.
    if (st.state !== 'waiting' && t.lastError && !t.pending) st = { ...st, issue: t.lastError };
    const last = t.pending ?? [...t.tools.values()].at(-1);
    return {
      id: path.basename(t.file, '.jsonl'),
      name,
      sub: !!meta,
      description: meta?.description ?? parent?.label ?? t.firstPrompt?.slice(0, 120) ?? '',
      ...st,
      lastAction: last ? `${last.name} · ${last.label}` : null,
      // ponytail: dernier message plafonné à 20 000 caractères (rapport des agents) ; endpoint dédié si des rapports plus longs arrivent.
      lastText: t.lastText.slice(0, 20_000),
      tokens: trackTokens(t).total,
      toolCount: t.tools.size,
      firstTs: t.firstTs,
      lastTs: t.lastTs,
      bars: [...t.tools.values()].map((x) => ({ name: x.name, kind: x.kind, label: x.label, start: x.start, end: x.end || null, error: x.error })),
      cost: [...t.usage.values()].reduce((n, u) => n + costOf(u), 0), // en dernier : ordre des clés JSON inchangé
    };
  }

  // Journal : lu à la demande (onglet ouvert), puis seulement la suite des fichiers. Fichier → curseur + lignes.
  const logs = new Map();
  const freshLog = (file) => ({ file, offset: 0, rest: '', entries: [], tools: new Map(), n: 0 });

  function logOf(t) {
    let c = logs.get(t.file);
    if (!c) logs.set(t.file, (c = freshLog(t.file)));
    const id = path.basename(t.file, '.jsonl');
    readNewLines(c, (o) => {
      for (const e of logEntriesOf(o, c.tools)) c.entries.push({ ...e, id: `${id}:${c.n++}` });
    }, () => Object.assign(c, freshLog(t.file)));
    return c.entries;
  }

  /** Tout le journal d'une session (agent principal + sous-agents), trié par date ; `since` : seulement la suite. */
  function sessionLog(sessionId, since = 0) {
    const main = mains().find((t) => t.sessionId === sessionId);
    if (!main) return null;
    const agents = [{ t: main, agent: 'Agent principal', sub: false }, ...subagentsOf(main).map((t) => ({ t, agent: metaOf(t).agentType ?? 'sous-agent', sub: true }))];
    const entries = agents.flatMap(({ t, agent, sub }) => logOf(t).filter((e) => e.ts >= since).map((e) => ({ ...e, agent, sub })));
    return { entries: entries.sort((a, b) => a.ts - b.ts) };
  }

  /** Trace d'une session en tours (cf. trace.mjs) ; null si inconnue. */
  function sessionTrace(sessionId, terminals) {
    const main = mains().find((t) => t.sessionId === sessionId);
    if (!main) return null;
    const now = Date.now();
    const subs = subagentsOf(main).map((track) => ({ track, meta: metaOf(track) }));
    return buildTrace({ main, subs, summary: summary(main, now, terminals), now });
  }

  return { scan, onHook, snapshot, detail, usageRows: rows, saveHistory, sessionCost, sessionLog, sessionTrace, hide, purge, purgeChats, isChat, cwdOf, idle, recentDirs, tracks };
}

const LIMITS_DIR = path.join(os.homedir(), '.vigie', 'limits');

/**
 * Taille max du contexte : celle que Claude Code passe à la statusline (sessions lancées par Vigie),
 * sinon déduite du modèle ([1m] = 1 M de tokens, 200 k sinon). Un contexte déjà au-delà de 200 k prouve une fenêtre de 1 M
 * (le transcript ne marque pas toujours le modèle [1m]).
 */
export function contextMax(sessionId, model, dir = LIMITS_DIR, used = 0) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, `${String(sessionId).replace(/[^\w-]/g, '')}.json`), 'utf8'));
    const size = d.context_window?.context_window_size;
    if (typeof size === 'number' && size > 0) return size;
  } catch { /* pas de relevé pour cette session */ }
  return /\[1m\]/i.test(model ?? '') || used > 200_000 ? 1_000_000 : 200_000;
}

/**
 * Relevés de quota de la statusline (un fichier par session, cf. README) : `{ ts, end, pct, week }`, fenêtres ouvertes
 * et closes depuis moins d'un jour (le store en garde le pic pour l'historique).
 */
export function readReadings(now, dir = LIMITS_DIR) {
  const readings = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const five = d.rate_limits?.five_hour;
      const end = toMs(five?.resets_at);
      // ponytail: ménage au passage, un relevé d'une fenêtre close depuis plus d'un jour ne sert plus.
      if (end && now - end > 86_400_000) { fs.rmSync(file, { force: true }); continue; }
      if (typeof five?.used_percentage === 'number' && end) readings.push({ ts: d.ts, end, pct: five.used_percentage / 100, week: d.rate_limits.seven_day });
    } catch { /* fichier en cours d'écriture ou illisible */ }
  }
  return readings;
}

function toolDetail(input = {}) {
  const v = input.command ?? input.file_path ?? input.url ?? input.pattern ?? input.description ?? '';
  return String(v).replace(/\s+/g, ' ').slice(0, 120);
}
