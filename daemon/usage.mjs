// Consommation (tokens, coût, fenêtre de quota), en fonctions pures : le store leur passe ses pistes et ses relevés.
import path from 'node:path';
import { tokensOf, projectName } from './ingest.mjs';
import { costOf } from './pricing.mjs';

export const DAY = 86_400_000;
export const HISTORY_DAYS = 14;
/** Historique gardé dans ~/.vigie/usage.json, et plus longue période demandable à GET /api/usage. */
// Le contrat (UsageQuery) borne aussi à 400 : il n'est pas importable ici (seul transport l'importe), usage.test.mjs vérifie l'égalité.
export const RETENTION_DAYS = 400;
export const MAX_QUERY_DAYS = RETENTION_DAYS;
const MIN = 60_000;
const H5 = 5 * 60 * MIN;
const dayOf = (ts) => new Date(ts).setHours(0, 0, 0, 0);
/** Minuit local `n` jours avant le jour de `now` : par le calendrier, pas `now - n × 24 h` (faux autour d'un changement d'heure). */
export const daysBefore = (now, n) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).getTime(); };
/** Longueur max d'un titre archivé : le titre suffit à reconnaître la session, inutile de garder plus de texte 400 jours. */
const TITLE_MAX = 80;

// ponytail: poids relatifs du tarif API pour approcher la consommation du quota (les lectures cache coûtent ~10 %).
export const weightOf = (u) => u.input + u.output * 5 + u.cacheCreate * 1.25 + u.cacheRead * 0.1;

/** Date d'un relevé de la statusline : secondes, millisecondes ou chaîne ISO ; 0 si illisible. */
export const toMs = (r) => (typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : Date.parse(r) || 0);

/** Blocs de 5 h façon quota : un bloc démarre à l'heure pleine de la première activité après la fin du précédent. */
export function blocksOf(events) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const blocks = [];
  let cur = null;
  for (const e of sorted) {
    if (!cur || e.ts >= cur.start + H5) {
      const start = Math.floor(e.ts / (60 * MIN)) * 60 * MIN;
      cur = { start, weight: 0, tokens: 0, cost: 0 };
      blocks.push(cur);
    }
    cur.weight += weightOf(e);
    cur.tokens += tokensOf(e);
    cur.cost += costOf(e);
  }
  return blocks;
}

/** Fenêtre de 5 h en cours, estimée à partir des événements (sans relevé réel). */
export function fiveHourWindow(events, now) {
  const blocks = blocksOf(events);
  const last = blocks.at(-1);
  const active = last && now < last.start + H5 ? last : null;
  // ponytail: la vraie limite n'est pas dans les transcripts ; on prend le plus gros bloc passé comme plafond estimé.
  const ceiling = Math.max(1, ...blocks.filter((b) => b !== active).map((b) => b.weight));
  if (!active) return { active: false, pct: 0, tokens: 0, start: null, end: null, projectedPct: 0, limitAt: null };
  const end = active.start + H5;
  const elapsed = Math.max(MIN, now - active.start);
  const rate = active.weight / elapsed;
  const pct = active.weight / ceiling;
  const projectedPct = (active.weight + rate * (end - now)) / ceiling;
  const limitAt = pct < 1 && projectedPct >= 1 ? now + (ceiling - active.weight) / rate : null;
  return { active: true, pct, tokens: active.tokens, start: active.start, end, projectedPct, limitAt };
}

/**
 * Consommation globale du snapshot : fenêtre de quota (relevé réel `real`, sinon estimation sur 14 jours) et total du jour.
 * `tracks` : toutes les pistes (sous-agents compris).
 */
export function usageSummary(tracks, now, real) {
  const events = [];
  const since = now - HISTORY_DAYS * DAY;
  for (const t of tracks) for (const u of t.usage.values()) if (u.ts >= since) events.push(u);
  // setHours : début du jour local, robuste au changement d'heure (pas de `now % DAY`).
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const today = { tokens: 0, input: 0, cacheCreate: 0, cacheRead: 0, cost: 0 };
  for (const e of events) {
    if (e.ts < todayStart) continue;
    today.tokens += tokensOf(e); today.input += e.input; today.cacheCreate += e.cacheCreate; today.cacheRead += e.cacheRead; today.cost += costOf(e);
  }
  const todayIn = today.input + today.cacheCreate + today.cacheRead;
  return {
    window: real ?? fiveHourWindow(events, now),
    today: { tokens: today.tokens, cost: today.cost, cacheRate: todayIn ? today.cacheRead / todayIn : 0 },
  };
}

/**
 * Lignes jour × modèle d'une piste (agent principal ou sous-agent), avec sa clé `track` = `<sessionId>/<fichier>` :
 * c'est l'unité de remplacement de l'historique (une piste chargée remplace toutes ses lignes archivées).
 * `meta` : `{ sessionId, title, project }` de la session principale.
 */
export function trackRows(t, { sessionId, title, project }) {
  const track = `${sessionId}/${path.basename(t.file)}`;
  const rows = new Map();
  for (const u of t.usage.values()) {
    if (!u.model || u.model === '<synthetic>') continue;
    const day = dayOf(u.ts);
    const key = `${day}|${u.model}`;
    let r = rows.get(key);
    if (!r) rows.set(key, r = { day, sessionId, track, title, project, model: u.model, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 });
    r.input += u.input; r.output += u.output; r.cacheCreate += u.cacheCreate; r.cacheRead += u.cacheRead; r.cost += costOf(u);
  }
  return [...rows.values()];
}

/**
 * Historique archivé + lignes des pistes en mémoire : une piste présente dans `live` remplace toutes ses lignes archivées
 * (jamais d'addition, donc idempotent), les autres (transcript effacé ou trop vieux pour être relu) restent.
 * Coupé à RETENTION_DAYS.
 */
export function mergeRows(archived, live, now) {
  const since = daysBefore(now, RETENTION_DAYS - 1);
  const tracks = new Set(live.map((r) => r.track));
  return [...archived.filter((r) => !tracks.has(r.track)), ...live].filter((r) => r.day >= since);
}

/** Agrège des lignes de piste par jour × session × modèle à partir du jour `since` (la clé `track` disparaît). */
export function sessionRows(rows, since) {
  const out = new Map();
  for (const r of rows) {
    if (r.day < since) continue;
    const key = `${r.day}|${r.sessionId}|${r.model}`;
    let o = out.get(key);
    if (!o) out.set(key, o = { day: r.day, sessionId: r.sessionId, title: r.title, project: r.project, model: r.model, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 });
    o.input += r.input; o.output += r.output; o.cacheCreate += r.cacheCreate; o.cacheRead += r.cacheRead; o.cost += r.cost;
  }
  return [...out.values()];
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';

/**
 * Contenu de ~/.vigie/usage.json, filtré ligne à ligne (édité à la main, écrit par une autre version…) ;
 * null si ce n'est pas un historique v1 ou si plus de la moitié des lignes est illisible (le store le traite comme corrompu).
 */
export function validHistory(json) {
  if (!json || typeof json !== 'object' || json.v !== 1) return null;
  const all = Array.isArray(json.rows) ? json.rows : [];
  const rows = all.filter((r) => r && typeof r === 'object'
    && ['day', 'input', 'output', 'cacheCreate', 'cacheRead', 'cost'].every((k) => isNum(r[k]))
    && ['sessionId', 'track', 'title', 'project', 'model'].every((k) => isStr(r[k])));
  // Plus de la moitié des lignes rejetées : fichier abîmé ou d'un autre format, mieux vaut le mettre de côté que l'écraser en partie.
  if (rows.length * 2 < all.length) return null;
  const windows = (Array.isArray(json.windows) ? json.windows : []).filter((w) => w && typeof w === 'object'
    && ['start', 'end', 'tokens', 'cost'].every((k) => isNum(w[k])) && (w.pct === null || isNum(w.pct)));
  return {
    rows: rows.map(({ day, sessionId, track, title, project, model, input, output, cacheCreate, cacheRead, cost }) => ({ day, sessionId, track, title, project, model, input, output, cacheCreate, cacheRead, cost })),
    windows: windows.map(({ start, end, tokens, cost, pct }) => ({ start, end, tokens, cost, pct })),
  };
}

/**
 * Lignes de consommation des `days` derniers jours, agrégées par jour × session × modèle, historique archivé compris.
 * `groups` : une entrée par session, `{ main, subs, title?, project? }` (title/project forcés pour une discussion).
 * L'UI filtre et regroupe à la volée (période, modèle) : servi à part pour ne pas alourdir le snapshot.
 */
export function usageRows(groups, now, days = HISTORY_DAYS, archived = []) {
  const since = daysBefore(now, Math.min(days, MAX_QUERY_DAYS) - 1);
  return { now, since, rows: sessionRows(mergeRows(archived, groupRows(groups), now), since) };
}

/**
 * Lignes de piste de toutes les sessions en mémoire (cf. usageRows pour `groups`).
 * `archive` : lignes destinées à usage.json, titre seul tronqué, jamais le début du prompt (un secret collé y vivrait 400 jours) ;
 * sinon le prompt sert de repli à l'affichage, en mémoire seulement.
 */
export function groupRows(groups, archive = false) {
  return groups.flatMap(({ main, subs, title, project }) => {
    const shown = title ?? (archive ? main.title?.slice(0, TITLE_MAX) : main.title ?? main.firstPrompt) ?? '(sans titre)';
    const meta = { sessionId: main.sessionId, title: shown, project: project ?? projectName(main.cwd) };
    return [main, ...subs].flatMap((t) => trackRows(t, meta));
  });
}

/**
 * Fenêtres de 5 h closes (`now` ≥ fin), avec le % réel relevé par la statusline quand on l'a.
 * `readings` : relevés `{ end, pct }` (fenêtres ouvertes ou closes).
 */
export function quotaBlocks(events, readings, now) {
  return blocksOf(events).filter((b) => b.start + H5 <= now).map((b) => {
    // ponytail: rattachement par la date de début (fenêtre réelle = fin - 5 h, à 1 h près) ; nos blocs estimés peuvent
    // décaler d'une heure ou plus du vrai découpage d'Anthropic, auquel cas pct reste null. Rattacher par chevauchement si ça se voit.
    const pcts = readings.filter((r) => Math.abs(r.end - H5 - b.start) <= 60 * MIN).map((r) => r.pct);
    return { start: b.start, end: b.start + H5, tokens: b.tokens, cost: b.cost, pct: pcts.length ? Math.max(...pcts) : null };
  });
}

/**
 * Fusion des fenêtres archivées et calculées. Une fenêtre archivée est figée : un bloc calculé qui en chevauche une
 * (même début, ou décalé parce qu'un transcript a disparu entre-temps) ne fait qu'en remonter `pct` (max), sur celle
 * qu'il recouvre le plus ; sinon il est ajouté. Jamais deux fenêtres qui se chevauchent, donc jamais de double compte ; idempotent.
 * `since` : début des événements en mémoire ; un bloc calculé qui commence dans les 5 h qui suivent peut être tronqué ou mal
 * aligné (son début réel est avant), il est ignoré.
 * ponytail: une fenêtre archivée tronquée le reste (tokens, coût) ; on préfère sous-compter que compter deux fois.
 */
export function mergeWindows(archived, live, since) {
  const out = archived.map((w) => ({ ...w }));
  const frozen = out.length;
  for (const w of live) {
    if (w.start < since + H5) continue;
    const overlap = (a) => Math.min(a.end, w.end) - Math.max(a.start, w.start);
    let best = null;
    for (const a of out.slice(0, frozen)) if (overlap(a) > 0 && (!best || overlap(a) > overlap(best))) best = a;
    if (!best) { out.push({ ...w }); continue; }
    if (w.pct !== null && (best.pct === null || w.pct > best.pct)) best.pct = w.pct;
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Coût d'une session au fil du temps, par agent, non cumulé : `points` = un point par agent et par pas où il a consommé.
 * Pas = max(1 min, durée / (maxPoints - 1)) arrondi à la minute supérieure : au plus `maxPoints` points par agent.
 * `tracks` : agent principal puis sous-agents ; `agent` = id de l'agent (nom du transcript, comme Agent.id).
 */
export function costSeries(tracks, maxPoints = 500) {
  const all = tracks.flatMap((t) => [...t.usage.values()]);
  if (!all.length) return { step: MIN, points: [] };
  // reduce plutôt que Math.min(...) : une longue session dépasserait la pile d'arguments.
  const start = Math.floor(all.reduce((m, u) => Math.min(m, u.ts), Infinity) / MIN) * MIN;
  const span = all.reduce((m, u) => Math.max(m, u.ts), 0) - start;
  const step = Math.ceil(Math.max(MIN, span / (maxPoints - 1)) / MIN) * MIN;
  const points = [];
  for (const t of tracks) {
    const agent = path.basename(t.file, '.jsonl');
    const buckets = new Map();
    for (const u of t.usage.values()) {
      const ts = start + Math.floor((u.ts - start) / step) * step;
      let p = buckets.get(ts);
      if (!p) buckets.set(ts, p = { ts, agent, cost: 0, tokens: 0 });
      p.cost += costOf(u); p.tokens += tokensOf(u);
    }
    points.push(...[...buckets.values()].sort((a, b) => a.ts - b.ts));
  }
  return { step, points };
}

/** Consommation d'une session : répartition des tokens (agent principal + sous-agents) et contexte actuel (sans sa taille max). */
export function sessionUsage(main, subs) {
  const u = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, calls: 0, context: 0 };
  for (const t of [main, ...subs]) for (const e of t.usage.values()) {
    u.input += e.input; u.output += e.output; u.cacheCreate += e.cacheCreate; u.cacheRead += e.cacheRead; u.calls++;
  }
  // Contexte = ce que le dernier appel de l'agent principal a envoyé au modèle.
  const last = [...main.usage.values()].reduce((a, b) => (b.ts >= (a?.ts ?? 0) ? b : a), null);
  if (last) u.context = last.input + last.cacheCreate + last.cacheRead;
  return u;
}

/**
 * Vraie fenêtre de quota à partir des relevés de la statusline (`{ ts, end, pct, week }`, au moins un, tous non clos).
 * Le quota est commun à toutes les sessions mais chacune ne connaît que le chiffre de son dernier
 * appel API : dans la fenêtre en cours, le plus haut pourcentage est donc le plus juste.
 */
export function quotaWindow(readings, now) {
  const end = Math.max(...readings.map((r) => r.end));
  const current = readings.filter((r) => r.end === end);
  const pct = Math.max(...current.map((r) => r.pct));
  const readAt = Math.max(...current.map((r) => r.ts));
  const weeks = readings.map((r) => r.week).filter((w) => typeof w?.used_percentage === 'number' && toMs(w.resets_at) > now);
  const weekPct = weeks.length ? Math.max(...weeks.map((w) => w.used_percentage)) / 100 : null;

  const start = end - 5 * 3_600_000;
  // Rythme mesuré jusqu'au relevé, prolongé jusqu'à la fin de la fenêtre.
  const rate = pct / Math.max(60_000, readAt - start);
  const projectedPct = pct + rate * Math.max(0, end - now);
  const limitAt = pct < 1 && projectedPct >= 1 ? Math.max(now, readAt + (1 - pct) / rate) : null;
  return { active: true, real: true, pct, weekPct, readAt, tokens: 0, start, end, projectedPct, limitAt };
}
