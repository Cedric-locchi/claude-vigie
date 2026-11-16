// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecord, newTrack } from './ingest.mjs';
import {
  DAY, MAX_QUERY_DAYS, RETENTION_DAYS, costSeries, daysBefore, groupRows, fiveHourWindow, mergeRows, mergeWindows, quotaBlocks, quotaWindow, trackRows, usageRows, usageSummary, validHistory,
} from './usage.mjs';

const T0 = Date.parse('2026-11-07T10:00:00Z');

// Piste construite en mémoire (sans disque) à partir d'appels { ts, id, model, input, output, cacheCreate, cacheRead }.
function trackOf(sessionId, calls, file = `/p/${sessionId}.jsonl`) {
  const t = newTrack(file);
  for (const c of calls) {
    applyRecord(t, {
      type: 'assistant', timestamp: new Date(c.ts).toISOString(), sessionId, cwd: '/dev/revu',
      message: { id: c.id, model: c.model, stop_reason: 'end_turn', content: [],
        usage: { input_tokens: c.input ?? 0, output_tokens: c.output ?? 0, cache_creation_input_tokens: c.cacheCreate ?? 0, cache_read_input_tokens: c.cacheRead ?? 0 } },
    });
  }
  return t;
}

test('fenêtre de 5 h : bloc à l’heure pleine, plafond = plus gros bloc passé', () => {
  const H = 3_600_000;
  const ev = (ts, input) => ({ ts, input, output: 0, cacheCreate: 0, cacheRead: 0 });
  const events = [ev(T0, 1000), ev(T0 + H, 1000), ev(T0 + 6 * H + 30 * 60_000, 500)];
  const w = fiveHourWindow(events, T0 + 7 * H);
  assert.equal(w.active, true);
  assert.equal(w.start, T0 + 6 * H);
  assert.equal(w.pct, 0.25);
  assert.equal(fiveHourWindow(events, T0 + 20 * H).active, false);
});

test('usageSummary : total du jour depuis minuit local, hier exclu, relevé réel prioritaire', () => {
  const now = new Date(2026, 10, 7, 15, 0).getTime(); // 15 h locales
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const m = 'claude-sonnet-5-5'; // 2 $ / M en entrée
  const t = trackOf('S', [
    { ts: todayStart - 60_000, id: 'hier', model: m, input: 1e6 },
    { ts: todayStart + 60_000, id: 'a', model: m, input: 1e6, cacheRead: 1e6 },
    { ts: now - 60_000, id: 'b', model: m, output: 10, cacheCreate: 2e6 },
  ]);
  const u = usageSummary([t], now, null);
  assert.equal(u.today.tokens, 1e6 + 1e6 + 10 + 2e6);
  assert.equal(u.today.cost, (2e6 + 1e6 * 0.2 + 10 * 10 + 2e6 * 2.5) / 1e6);
  assert.equal(u.today.cacheRate, 1e6 / 4e6);
  assert.equal(u.window.active, true); // estimation tirée des événements
  const real = { active: true, real: true };
  assert.equal(usageSummary([t], now, real).window, real);
  assert.deepEqual(usageSummary([], now, null).today, { tokens: 0, cost: 0, cacheRate: 0 });
});

test('usageRows : jour × session × modèle, sous-agents compris, sans <synthetic> ni appel sans modèle', () => {
  const now = new Date(2026, 10, 7, 15, 0).getTime();
  const today = new Date(now).setHours(0, 0, 0, 0);
  const yesterday = new Date(now - 86_400_000).setHours(0, 0, 0, 0);
  const o = 'claude-opus-5-5';
  const main = trackOf('S', [
    { ts: now - 3000, id: 'a', model: o, output: 1 },
    { ts: now - 2000, id: 'b', model: o, output: 2 },
    { ts: yesterday + 3_600_000, id: 'c', model: o, output: 4 },
    { ts: now - 1000, id: 'd', model: '<synthetic>', output: 100 },
    { ts: now - 500, id: 'e', output: 100 },
    { ts: now - 20 * 86_400_000, id: 'vieux', model: o, output: 100 },
  ]);
  const sub = trackOf('S', [{ ts: now - 100, id: 'f', model: 'claude-haiku-5', output: 8 }], '/p/S/subagents/agent-x.jsonl');
  const other = trackOf('T', [{ ts: now - 100, id: 'g', model: o, output: 16 }]);
  const r = usageRows([{ main, subs: [sub] }, { main: other, subs: [] }], now);
  assert.equal(r.now, now);
  assert.deepEqual(r.rows.map((x) => [x.day, x.sessionId, x.model, x.output, x.project]).sort(), [
    [today, 'S', 'claude-haiku-5', 8, 'revu'],
    [today, 'S', o, 3, 'revu'],
    [today, 'T', o, 16, 'revu'],
    [yesterday, 'S', o, 4, 'revu'],
  ].sort());
});

test('quotaWindow : le plus haut % de la fenêtre en cours gagne, limitAt null si non projetée', () => {
  const now = Date.parse('2026-11-08T01:00:00Z');
  const end = Date.parse('2026-11-08T04:20:00Z');
  const week = { used_percentage: 33, resets_at: end / 1000 + 86_400 };
  const w = quotaWindow([
    { ts: now - 30 * 60_000, end, pct: 0.1, week },
    { ts: now - 60_000, end, pct: 0.53, week: { used_percentage: 40, resets_at: end / 1000 + 86_400 } },
    { ts: now - 10_000, end: end - 3_600_000, pct: 0.9, week }, // fenêtre précédente : ignorée pour le %
  ], now);
  assert.equal(w.pct, 0.53);
  assert.equal(w.readAt, now - 60_000);
  assert.equal(w.weekPct, 0.4);
  assert.equal(w.end, end);
  assert.equal(w.start, end - 5 * 3_600_000);
  assert.ok(w.projectedPct > w.pct);
  assert.ok(w.limitAt >= now && w.limitAt < end); // 53 % en 1 h 40 : 100 % atteint avant la fin
  const calm = quotaWindow([{ ts: now - 60_000, end, pct: 0.1, week: null }], now);
  assert.equal(calm.weekPct, null);
  assert.ok(calm.projectedPct < 1);
  assert.equal(calm.limitAt, null); // 10 % au rythme actuel : pas de limite projetée
});

test('trackRows : une ligne par jour local et par modèle, clé de piste session/fichier', () => {
  const now = new Date(2026, 10, 7, 15, 0).getTime();
  const today = new Date(now).setHours(0, 0, 0, 0);
  const o = 'claude-opus-5-5';
  const t = trackOf('S', [
    { ts: today + 60_000, id: 'a', model: o, output: 1 },
    { ts: today + 120_000, id: 'b', model: o, output: 2 },
    { ts: today - 60_000, id: 'c', model: o, output: 4 }, // hier, 23 h 59 locales
    { ts: today + 60_000, id: 'd', model: 'claude-haiku-5', output: 8 },
    { ts: today + 60_000, id: 'e', model: '<synthetic>', output: 16 },
  ], '/p/S/subagents/agent-x.jsonl');
  const rows = trackRows(t, { sessionId: 'S', title: 'T', project: 'P' });
  assert.deepEqual(rows.map((r) => [r.day, r.model, r.output, r.track, r.title, r.project]).sort(), [
    [today, o, 3, 'S/agent-x.jsonl', 'T', 'P'],
    [today, 'claude-haiku-5', 8, 'S/agent-x.jsonl', 'T', 'P'],
    [today - 86_400_000, o, 4, 'S/agent-x.jsonl', 'T', 'P'],
  ].sort());
});

test('mergeRows : une piste en mémoire remplace ses lignes archivées, les autres restent, coupé à 400 jours ; idempotent', () => {
  const now = new Date(2026, 10, 7, 15, 0).getTime();
  const day = new Date(now).setHours(0, 0, 0, 0);
  const row = (track, d, output) => ({ day: d, sessionId: track.split('/')[0], track, title: 't', project: 'p', model: 'm', input: 0, output, cacheCreate: 0, cacheRead: 0, cost: 0 });
  const archived = [row('S/S.jsonl', day, 5), row('S/S.jsonl', day - DAY, 3), row('T/T.jsonl', day, 7), row('U/U.jsonl', day - RETENTION_DAYS * DAY, 9)];
  const live = [row('S/S.jsonl', day, 6)];
  const merged = mergeRows(archived, live, now);
  assert.deepEqual(merged.map((r) => [r.track, r.output]).sort(), [['S/S.jsonl', 6], ['T/T.jsonl', 7]]);
  assert.deepEqual(mergeRows(merged, live, now), merged);
  // Archive + piste rechargée : usageRows ne double pas.
  const t = trackOf('S', [{ ts: now - 1000, id: 'a', model: 'claude-opus-5-5', output: 6 }]);
  const once = usageRows([{ main: t, subs: [] }], now, 14, mergeRows([], usageRows([{ main: t, subs: [] }], now).rows.map((r) => ({ ...r, track: 'S/S.jsonl' })), now));
  assert.equal(once.rows.reduce((n, r) => n + r.output, 0), 6);
  // Bornes de la période demandée.
  assert.equal(usageRows([], now, 90).since, daysBefore(now, 89));
});

test('validHistory : version, lignes et fenêtres mal formées écartées', () => {
  assert.equal(validHistory(null), null);
  assert.equal(validHistory([]), null);
  assert.equal(validHistory({ v: 2, rows: [] }), null);
  const ok = { day: 1, sessionId: 'S', track: 'S/S.jsonl', title: 't', project: 'p', model: 'm', input: 1, output: 2, cacheCreate: 3, cacheRead: 4, cost: 5 };
  const h = validHistory({ v: 1, rows: [ok, { ...ok, cost: 'x' }, null, { ...ok, track: undefined }, { ...ok, extra: 1 }, ok, ok], windows: [{ start: 0, end: 1, tokens: 2, cost: 3, pct: null }, { start: 0, end: 1, tokens: 2, cost: 3 }, 7] });
  assert.deepEqual(h.rows, [ok, ok, ok, ok]);
  assert.deepEqual(h.windows, [{ start: 0, end: 1, tokens: 2, cost: 3, pct: null }]);
  assert.deepEqual(validHistory({ v: 1 }), { rows: [], windows: [] });
  // Plus de la moitié des lignes illisibles : traité comme corrompu.
  assert.equal(validHistory({ v: 1, rows: [ok, { ...ok, day: 'x' }, { ...ok, cost: null }] }), null);
});

test('quotaBlocks : fenêtres closes seulement, % réel rattaché à 1 h près, null sans relevé', () => {
  const H = 3_600_000;
  const ev = (ts, input) => ({ ts, model: 'claude-sonnet-5-5', input, output: 0, cacheCreate: 0, cacheRead: 0 });
  const events = [ev(T0 + 10 * 60_000, 1e6), ev(T0 + H, 1e6), ev(T0 + 6 * H, 1e6), ev(T0 + 12 * H, 1e6)];
  const now = T0 + 12 * H + 60_000; // le bloc de T0 + 12 h est encore ouvert
  const readings = [{ end: T0 + 5 * H + 30 * 60_000, pct: 0.4 }, { end: T0 + 5 * H, pct: 0.6 }, { end: T0 + 9 * H, pct: 0.9 }];
  assert.deepEqual(quotaBlocks(events, readings, now), [
    { start: T0, end: T0 + 5 * H, tokens: 2e6, cost: 4, pct: 0.6 },
    { start: T0 + 6 * H, end: T0 + 11 * H, tokens: 1e6, cost: 2, pct: null }, // relevé à 2 h de décalage : non rattaché
  ]);
});

test('mergeWindows : archive figée (seul pct remonte), bloc qui chevauche jamais ajouté, bord des événements ignoré, idempotent', () => {
  const H = 3_600_000;
  const w = (start, tokens, pct) => ({ start, end: start + 5 * H, tokens, cost: tokens / 10, pct });
  const archived = [w(0, 100, 0.5), w(10 * H, 50, null)];
  const live = [w(2 * H, 999, null), w(10 * H, 80, 0.3), w(20 * H, 10, null)];
  const m = mergeWindows(archived, live, 0); // bloc à 2 h : moins de 5 h après le début des événements, ignoré
  assert.deepEqual(m, [w(0, 100, 0.5), { ...w(10 * H, 50, 0.3) }, w(20 * H, 10, null)]);
  assert.deepEqual(mergeWindows(m, live, 0), m);
  assert.deepEqual(mergeWindows([w(0, 100, 0.5)], [w(0, 10, null)], -10 * H), [w(0, 100, 0.5)]); // un bloc relu en partie ne fait pas baisser l'archive
  // Bloc recalculé décalé d'1 h (transcript effacé entre-temps) : une seule fenêtre, pas de double compte.
  const shifted = mergeWindows([w(10 * H, 50, 0.2)], [w(11 * H, 40, 0.6)], 0);
  assert.deepEqual(shifted, [w(10 * H, 50, 0.6)]);
  assert.deepEqual(mergeWindows(shifted, [w(11 * H, 40, 0.6)], 0), shifted);
});

test('bornes de jours par le calendrier (changement d’heure) ; 400 jours = borne du contrat', async () => {
  // Paris : passage à l'heure d'hiver le 25/10/2026. 30 jours avant le 07/11 à 0 h 30 = minuit du 08/10, quel que soit le fuseau.
  const now = new Date(2026, 10, 7, 0, 30).getTime();
  assert.equal(daysBefore(now, 30), new Date(2026, 9, 8).getTime());
  assert.equal(usageRows([], now, 31).since, new Date(2026, 9, 8).getTime());
  const { UsageQuery } = await import('../contract/index.mjs');
  assert.equal(MAX_QUERY_DAYS, RETENTION_DAYS);
  assert.equal(UsageQuery.safeParse({ days: MAX_QUERY_DAYS }).success, true);
  assert.equal(UsageQuery.safeParse({ days: MAX_QUERY_DAYS + 1 }).success, false);
});

test('groupRows : le début du prompt sert de titre à l’affichage, jamais dans les lignes archivées (titre tronqué)', () => {
  const t = trackOf('S', [{ ts: T0, id: 'a', model: 'claude-opus-5-5', output: 1 }]);
  t.firstPrompt = 'mon secret';
  assert.equal(groupRows([{ main: t, subs: [] }])[0].title, 'mon secret');
  assert.equal(groupRows([{ main: t, subs: [] }], true)[0].title, '(sans titre)');
  t.title = 'x'.repeat(200);
  assert.equal(groupRows([{ main: t, subs: [] }], true)[0].title.length, 80);
});

test('costSeries : points par agent non cumulés, somme = coût total, au plus 500 points par agent', () => {
  const o = 'claude-opus-5-5';
  const main = trackOf('S', [{ ts: T0, id: 'a', model: o, output: 1e6 }, { ts: T0 + 30_000, id: 'b', model: o, output: 1e6 }, { ts: T0 + 5 * 60_000, id: 'c', model: o, output: 1e6 }]);
  const sub = trackOf('S', [{ ts: T0 + 60_000, id: 'd', model: 'claude-sonnet-5-5', input: 1e6 }], '/p/S/subagents/agent-x.jsonl');
  const s = costSeries([main, sub]);
  assert.equal(s.step, 60_000);
  assert.deepEqual(s.points, [
    { ts: T0, agent: 'S', cost: 40, tokens: 2e6 },
    { ts: T0 + 5 * 60_000, agent: 'S', cost: 20, tokens: 1e6 },
    { ts: T0 + 60_000, agent: 'agent-x', cost: 2, tokens: 1e6 },
  ]);
  // Longue session : pas élargi, borne respectée.
  const calls = Array.from({ length: 3000 }, (_, i) => ({ ts: T0 + i * 37_000, id: `x${i}`, model: o, output: 1000 }));
  const long = costSeries([trackOf('S', calls)]);
  assert.ok(long.points.length <= 500, String(long.points.length));
  assert.equal(long.step % 60_000, 0);
  assert.ok(Math.abs(long.points.reduce((n, p) => n + p.cost, 0) - 3000 * 0.02) < 1e-9);
  assert.deepEqual(costSeries([]), { step: 60_000, points: [] });
});
