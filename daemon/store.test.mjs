// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './store.mjs';
import * as C from '../contract/index.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

// Sortie conforme au contrat : parse retire les clés inconnues, donc l'égalité échoue sur un champ manquant comme sur un champ en trop.
const conforme = (S, v) => { const j = JSON.parse(JSON.stringify(v)); assert.deepStrictEqual(S.parse(j), j); };

const line = (ts, text) => JSON.stringify({
  type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: 'S', cwd: '/dev/revu',
  message: { id: `m${ts}`, stop_reason: 'end_turn', content: [{ type: 'text', text }] },
}) + '\n';

test('une session supprimée disparaît, et réapparaît si elle reprend', () => {
  const tmp = tempDir('vigie-store-');
  const file = path.join(tmp, 'projects', 'p', 'S.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const hiddenFile = path.join(tmp, 'hidden.json');
  fs.writeFileSync(file, line(Date.now() - 60_000, 'fini'));

  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile, limitsDir: path.join(tmp, 'limits') });
  store.scan();
  assert.deepEqual(store.snapshot([]).sessions.map((s) => s.id), ['S']);

  store.hide('S');
  assert.equal(store.snapshot([]).sessions.length, 0);
  // Persisté : un redémarrage du daemon la garde masquée.
  const again = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile, limitsDir: path.join(tmp, 'limits') });
  again.scan();
  assert.equal(again.snapshot([]).sessions.length, 0);

  fs.appendFileSync(file, line(Date.now() + 1000, 'reprise'));
  again.scan();
  assert.deepEqual(again.snapshot([]).sessions.map((s) => s.id), ['S']);
});

test('transcript déplacé (sortie de worktree) : une seule session, sous le nouveau chemin', () => {
  const tmp = tempDir('vigie-relocate-');
  const from = path.join(tmp, 'p--claude-worktrees-w', 'S.jsonl');
  const to = path.join(tmp, 'p', 'S.jsonl');
  fs.mkdirSync(path.join(path.dirname(from), 'S', 'subagents'), { recursive: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(from, line(Date.now() - 60_000, 'dans le worktree'));
  fs.writeFileSync(path.join(path.dirname(from), 'S', 'subagents', 'agent-a.jsonl'), line(Date.now() - 60_000, 'sous-agent'));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  assert.equal(store.snapshot([]).sessions.length, 1);

  // Claude Code déplace le transcript et le dossier des sous-agents vers le projet principal.
  fs.renameSync(from, to);
  fs.renameSync(path.join(path.dirname(from), 'S'), path.join(path.dirname(to), 'S'));
  fs.appendFileSync(to, line(Date.now(), 'de retour'));
  assert.equal(store.scan(), true);
  const sessions = store.snapshot([]).sessions;
  assert.deepEqual(sessions.map((s) => [s.id, s.subagents]), [['S', 1]]);
  assert.deepEqual([...store.tracks.keys()].sort(), [to, path.join(path.dirname(to), 'S', 'subagents', 'agent-a.jsonl')].sort());
});

test('purge : la discussion est effacée du disque, les autres sessions restent', () => {
  const tmp = tempDir('vigie-purge-');
  const dir = path.join(tmp, 'p');
  fs.mkdirSync(path.join(dir, 'S', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'S.jsonl'), line(Date.now() - 60_000, 'chat'));
  fs.writeFileSync(path.join(dir, 'S', 'subagents', 'agent-a.jsonl'), line(Date.now() - 60_000, 'sous-agent'));
  fs.writeFileSync(path.join(dir, 'T.jsonl'), line(Date.now() - 60_000, 'projet'));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();

  store.purge('S');
  assert.deepEqual(fs.readdirSync(dir), ['T.jsonl']);
  assert.deepEqual([...store.tracks.keys()], [path.join(dir, 'T.jsonl')]);
});

test('limites réelles : le plus haut relevé de la fenêtre en cours gagne, les vieilles fenêtres sont ignorées', async () => {
  const { readReadings } = await import('./store.mjs');
  const { quotaWindow } = await import('./usage.mjs');
  // Même calcul que store.snapshot : relevés des fenêtres encore ouvertes, sinon estimation (null ici).
  const realWindow = (now, dir) => { const open = readReadings(now, dir).filter((r) => r.end > now); return open.length ? quotaWindow(open, now) : null; };
  const dir = tempDir('vigie-limits-');
  const now = Date.parse('2026-11-08T01:00:00Z');
  const end = Date.parse('2026-11-08T04:20:00Z') / 1000;
  const write = (name, ts, five, resets = end) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({
    ts, rate_limits: { five_hour: { used_percentage: five, resets_at: resets }, seven_day: { used_percentage: 33, resets_at: end + 86_400 } },
  }));
  assert.equal(realWindow(now, dir), null);
  write('inactive', now - 30 * 60_000, 0); // session restée sur un vieux chiffre
  write('active', now - 60_000, 53);
  write('ancienne', now - 2 * 86_400_000, 90, end - 3 * 86_400);
  const w = realWindow(now, dir);
  assert.equal(w.pct, 0.53);
  assert.equal(w.weekPct, 0.33);
  assert.equal(w.readAt, now - 60_000);
  assert.equal(w.end, end * 1000);
  assert.ok(w.projectedPct > w.pct);
  assert.equal(fs.existsSync(path.join(dir, 'ancienne.json')), false);
});

test('détail : consommation de la session, contexte = dernier appel', () => {
  const tmp = tempDir('vigie-usage-');
  const file = path.join(tmp, 'p', 'S.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const call = (ts, id, input, output, cacheCreate, cacheRead) => JSON.stringify({
    type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: 'S', cwd: '/dev/revu',
    message: { id, stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheCreate, cache_read_input_tokens: cacheRead } },
  }) + '\n';
  const now = Date.now();
  fs.writeFileSync(file, call(now - 2000, 'a', 10, 100, 1000, 0) + call(now - 1000, 'b', 5, 50, 200, 1000));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  conforme(C.SessionDetail, store.detail('S', []));
  assert.deepEqual(store.detail('S', []).usage, { input: 15, output: 150, cacheCreate: 1200, cacheRead: 1000, calls: 2, context: 1205, contextMax: 200_000 });
});

test('détail : un dernier message coupé à 20 000 caractères est signalé (lastTextTruncated)', () => {
  const tmp = tempDir('vigie-trunc-');
  fs.mkdirSync(path.join(tmp, 'p'), { recursive: true });
  const now = Date.now();
  const say = (n, id) => JSON.stringify({
    type: 'assistant', timestamp: new Date(now - 1000).toISOString(), sessionId: id, cwd: '/dev/revu',
    message: { id: 'a', stop_reason: 'end_turn', content: [{ type: 'text', text: 'x'.repeat(n) }], usage: { input_tokens: 1, output_tokens: 1 } },
  }) + '\n';
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  for (const [n, id, truncated] of [[20_000, 'A', false], [20_001, 'B', true]]) {
    fs.writeFileSync(path.join(tmp, 'p', `${id}.jsonl`), say(n, id));
    store.scan();
    const d = store.detail(id, []);
    conforme(C.SessionDetail, d);
    assert.equal(d.agents[0].lastText.length, 20_000);
    assert.equal(d.agents[0].lastTextTruncated, truncated);
  }
});

test('coût par modèle et lignes de consommation par jour × session × modèle', async () => {
  const { costOf, family } = await import('./pricing.mjs');
  // Opus 5.5 : 4 $ / 20 $ par M ; cache écrit 1,25 × entrée, lu 0,1 × entrée.
  assert.equal(costOf({ model: 'claude-opus-5-5', input: 1e6, output: 1e6, cacheCreate: 1e6, cacheRead: 1e6 }), 4 + 20 + 5 + 0.4);
  assert.equal(costOf({ model: 'claude-sonnet-5-5', input: 1e6, output: 0, cacheCreate: 0, cacheRead: 0 }), 2);
  assert.equal(costOf({ model: 'gpt-x', input: 1e6, output: 0, cacheCreate: 0, cacheRead: 0 }), 0);
  assert.equal(family('claude-opus-5-5'), 'opus');

  const tmp = tempDir('vigie-rows-');
  const file = path.join(tmp, 'p', 'S.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const call = (ts, id, model, output) => JSON.stringify({
    type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: 'S', cwd: '/dev/revu',
    message: { id, model, stop_reason: 'end_turn', content: [], usage: { input_tokens: 0, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  }) + '\n';
  const now = Date.now();
  fs.writeFileSync(file, call(now - 3000, 'a', 'claude-opus-5-5', 1e6) + call(now - 2000, 'b', 'claude-opus-5-5', 1e6) + call(now - 1000, 'c', 'claude-sonnet-5-5', 1e6));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  conforme(C.UsageRows, store.usageRows());
  const rows = store.usageRows().rows.sort((a, b) => b.cost - a.cost);
  assert.deepEqual(rows.map((r) => [r.model, r.output, r.cost, r.project]), [['claude-opus-5-5', 2e6, 40, 'revu'], ['claude-sonnet-5-5', 1e6, 10, 'revu']]);
});

test('résumé : coût estimé et activité par minute du dernier quart d’heure', () => {
  const tmp = tempDir('vigie-act-');
  const file = path.join(tmp, 'p', 'S.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = Date.now();
  const call = (ts, id) => JSON.stringify({
    type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: 'S', cwd: '/dev/revu',
    message: { id, model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [], usage: { input_tokens: 1e6, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  }) + '\n';
  fs.writeFileSync(file, call(now - 14.5 * 60_000, 'a') + call(now - 20_000, 'b') + call(now - 10_000, 'c'));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  conforme(C.Snapshot, store.snapshot([]));
  const s = store.snapshot([]).sessions[0];
  assert.equal(s.cost, 6); // 3 M d'entrée Sonnet à 2 $
  assert.equal(s.activity.length, 15);
  assert.equal(s.activity[0], 1);
  assert.equal(s.activity[14], 2);
});

test('journal : prompts, messages, outils, résultats et erreurs, puis seulement la suite', () => {
  const tmp = tempDir('vigie-log-');
  const file = path.join(tmp, 'p', 'S.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t0 = Date.now() - 10_000;
  const rec = (i, o) => JSON.stringify({ timestamp: new Date(t0 + i * 1000).toISOString(), sessionId: 'S', cwd: '/dev/revu', ...o }) + '\n';
  fs.writeFileSync(file,
    rec(0, { type: 'user', message: { content: 'Lance les tests' } }) +
    rec(1, { type: 'assistant', message: { id: 'a', content: [{ type: 'thinking', thinking: 'Je regarde.' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } }) +
    rec(2, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'FAIL x.spec.ts' }] } }) +
    rec(3, { type: 'system', subtype: 'turn_duration', durationMs: 4200, messageCount: 3 }));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  conforme(C.SessionLog, store.sessionLog('S'));
  const log = store.sessionLog('S').entries;
  assert.deepEqual(log.map((e) => [e.kind, e.title]), [
    ['prompt', 'Toi'], ['thinking', 'Réflexion'], ['tool', 'Bash · npm test'], ['error', 'Bash'], ['system', 'Durée du tour'],
  ]);
  assert.equal(log[3].text, 'FAIL x.spec.ts');
  assert.equal(log[4].text, '4 s, 3 messages');
  assert.equal(new Set(log.map((e) => e.id)).size, 5);

  fs.appendFileSync(file, rec(5, { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'Corrigé.' }] } }));
  const next = store.sessionLog('S', t0 + 5000).entries;
  assert.deepEqual(next.map((e) => [e.kind, e.text]), [['assistant', 'Corrigé.']]);
  assert.equal(store.sessionLog('inconnue'), null);
});

test('trace : tours délimités par les messages, sous-agents rattachés à leur appel', () => {
  const tmp = tempDir('vigie-trace-');
  const dir = path.join(tmp, 'p');
  fs.mkdirSync(path.join(dir, 'S', 'subagents'), { recursive: true });
  const t0 = Date.now() - 3 * 3_600_000; // tout dans le passé, sous-agent compris (7206 s)
  const rec = (s, o) => JSON.stringify({ timestamp: new Date(t0 + s * 1000).toISOString(), sessionId: 'S', cwd: '/dev/revu', ...o }) + '\n';
  const tool = (s, id, name, input) => rec(s, { type: 'assistant', message: { id: `m${s}`, content: [{ type: 'tool_use', id, name, input }] } });
  const result = (s, id, isError = false) => rec(s, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }] } });
  fs.writeFileSync(path.join(dir, 'S.jsonl'),
    rec(0, { type: 'user', message: { content: 'Corrige le test' } }) +
    tool(1, 'r1', 'Read', { file_path: '/dev/revu/a.ts' }) + result(2, 'r1') +
    tool(3, 'b1', 'Bash', { command: 'npm test' }) + result(40, 'b1', true) +
    rec(42, { type: 'assistant', message: { id: 'fin1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fait.' }], usage: { input_tokens: 1, output_tokens: 1 } } }) +
    // 2 h plus tard : nouveau tour, qui lance un sous-agent
    rec(7200, { type: 'user', message: { content: '<command-name>/review</command-name>' } }) +
    tool(7201, 'task1', 'Task', { description: 'explorer le code' }) + result(7260, 'task1'));
  fs.writeFileSync(path.join(dir, 'S', 'subagents', 'agent-x.jsonl'),
    rec(7202, { type: 'user', isSidechain: true, message: { content: 'explore' } }) + tool(7203, 'g1', 'Grep', { pattern: 'timeline' }) + result(7204, 'g1') +
    tool(7205, 'e1', 'Edit', { file_path: '/dev/revu/src/deep/b.ts' }) + result(7206, 'e1'));
  fs.writeFileSync(path.join(dir, 'S', 'subagents', 'agent-x.meta.json'), JSON.stringify({ toolUseId: 'task1', agentType: 'Explore', description: 'explorer le code', finished: true }));

  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  const trace = store.sessionTrace('S', []);
  conforme(C.SessionTrace, trace);
  conforme(C.SessionDetail, store.detail('S', []));
  conforme(C.Snapshot, store.snapshot([]));
  assert.equal(store.snapshot([]).sessions.find((s) => s.id === 'S').toolPath, null); // dernier outil = Task, sans fichier
  assert.deepEqual(trace.turns.map((t) => [t.index, t.prompt, t.steps.map((x) => x.name)]), [[1, 'Corrige le test', ['Read', 'Bash']], [2, '/review', ['Task']]]);
  // Le premier tour s'arrête à la réponse de Claude (42 s), pas au message suivant (2 h plus tard).
  assert.equal(trace.turns[0].end - trace.turns[0].start, 42_000);
  assert.equal(trace.turns[0].steps[1].error, true);
  const agent = trace.turns[1].steps[0].agent;
  assert.deepEqual([agent.name, agent.state, agent.steps.map((x) => x.name)], ['Explore', 'done', ['Grep', 'Edit']]);
  // Chemin complet pour les outils à fichier (label raccourci), rien pour Bash ou Grep.
  assert.deepEqual(trace.turns[0].steps.map((x) => [x.label, x.path]), [['revu/a.ts', '/dev/revu/a.ts'], ['npm test', undefined]]);
  assert.equal(agent.steps[1].path, '/dev/revu/src/deep/b.ts');
  assert.equal(agent.steps[0].path, undefined);
  assert.equal('path' in trace.turns[0].steps[1], false);
  // Le journal relie chaque ligne d'outil à son appel.
  assert.deepEqual(store.sessionLog('S').entries.filter((e) => e.ref === 'b1').map((e) => e.kind), ['tool', 'error']);
});

test('taille max du contexte : relevé de la statusline, sinon déduite du modèle', async () => {
  const { contextMax } = await import('./store.mjs');
  const dir = tempDir('vigie-ctx-');
  fs.writeFileSync(path.join(dir, 's1.json'), JSON.stringify({ ts: 1, context_window: { context_window_size: 400_000 } }));
  assert.equal(contextMax('s1', 'claude-opus-5-5', dir), 400_000);
  assert.equal(contextMax('s2', 'claude-opus-5-5[1m]', dir), 1_000_000);
  assert.equal(contextMax('s2', null, dir), 200_000);
  assert.equal(contextMax('s2', 'claude-opus-5-5', dir, 470_000), 1_000_000); // déjà > 200 k : fenêtre de 1 M
});

// Ligne de transcript d'une session donnée ; `pending` : appel d'outil sans résultat (sous-agent en cours).
const rec = (sid, ts, { pending = false, usage = false } = {}) => JSON.stringify({
  type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: sid, cwd: '/dev/revu',
  message: {
    id: `m${sid}${ts}`, model: 'claude-sonnet-5-5', stop_reason: pending ? 'tool_use' : 'end_turn',
    content: pending ? [{ type: 'tool_use', id: `tu${ts}`, name: 'Bash', input: { command: 'npm test' } }] : [{ type: 'text', text: 'ok' }],
    ...(usage ? { usage: { input_tokens: 1000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } : {}),
  },
}) + '\n';

test('snapshot : session de plus d’un jour visible seulement avec un terminal claude, ou un sous-agent récent', () => {
  const tmp = tempDir('vigie-day-');
  const dir = path.join(tmp, 'p');
  fs.mkdirSync(path.join(dir, 'R', 'subagents'), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'V.jsonl'), rec('V', now - 2 * 86_400_000));
  fs.writeFileSync(path.join(dir, 'R.jsonl'), rec('R', now - 2 * 86_400_000));
  fs.writeFileSync(path.join(dir, 'R', 'subagents', 'agent-a.jsonl'), rec('R', now - 60_000));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  const ids = (terms) => store.snapshot(terms).sessions.map((s) => s.id);
  assert.deepEqual(ids([]), ['R']);
  assert.equal(store.snapshot([]).sessions[0].lastTs, Date.parse(new Date(now - 60_000).toISOString()));
  assert.deepEqual(ids([{ id: 't1', sessionId: 'V', kind: 'shell' }]), ['R']);
  assert.deepEqual(ids([{ id: 't1', sessionId: 'V', kind: 'claude' }]).sort(), ['R', 'V']);
});

test('sous-agents : comptés par session, oubliés après purge', () => {
  const tmp = tempDir('vigie-subs-');
  const dir = path.join(tmp, 'p');
  const now = Date.now();
  for (const sid of ['S', 'T']) {
    fs.mkdirSync(path.join(dir, sid, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), rec(sid, now - 60_000, { usage: true }));
    fs.writeFileSync(path.join(dir, sid, 'subagents', 'agent-a.jsonl'), rec(sid, now - 30_000, { usage: true }));
  }
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  assert.deepEqual(store.snapshot([]).sessions.map((s) => [s.id, s.subagents]).sort(), [['S', 1], ['T', 1]]);
  assert.equal(store.detail('S', []).agents.length, 2);

  store.purge('S');
  // Le transcript réapparaît (claude écrit encore en quittant) : ses anciens sous-agents ne reviennent pas.
  fs.writeFileSync(path.join(dir, 'S.jsonl'), rec('S', now - 10_000, { usage: true }));
  store.scan();
  assert.equal(store.detail('S', []).agents.length, 1);
  assert.deepEqual(store.usageRows().rows.map((r) => [r.sessionId, r.input]).sort(), [['S', 1000], ['T', 2000]]);
});

test('sous-agent en cours : meta relu tant qu’il n’est pas terminé', () => {
  const tmp = tempDir('vigie-meta-');
  const dir = path.join(tmp, 'p');
  fs.mkdirSync(path.join(dir, 'S', 'subagents'), { recursive: true });
  const now = Date.now();
  const meta = path.join(dir, 'S', 'subagents', 'agent-a.meta.json');
  fs.writeFileSync(path.join(dir, 'S.jsonl'), rec('S', now - 60_000, { pending: true }));
  fs.writeFileSync(path.join(dir, 'S', 'subagents', 'agent-a.jsonl'), rec('S', now - 30_000, { pending: true }));
  fs.writeFileSync(meta, JSON.stringify({ agentType: 'Explore', finished: false }));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  assert.equal(store.snapshot([]).sessions[0].activeSubagents, 1);
  fs.writeFileSync(meta, JSON.stringify({ agentType: 'Explore', finished: true }));
  assert.equal(store.snapshot([]).sessions[0].activeSubagents, 0);
  // Repris après coup (SendMessage) : le transcript avance après le meta, il repasse en cours.
  const old = (now - 120_000) / 1000;
  fs.utimesSync(meta, old, old);
  fs.appendFileSync(path.join(dir, 'S', 'subagents', 'agent-a.jsonl'), rec('S', now - 1000, { pending: true }));
  store.scan();
  assert.equal(store.snapshot([]).sessions[0].activeSubagents, 1);
});

// Transcript minimal d'une session `sid` lancée dans `cwd`.
const at = (sid, cwd, ts) => JSON.stringify({
  type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: sid, cwd,
  message: { id: `m${sid}${ts}`, stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
}) + '\n';

function chatFixture() {
  const tmp = tempDir('vigie-chat-');
  const chat = path.join(tmp, 'chat');
  const projA = path.join(tmp, 'a');
  const projB = path.join(tmp, 'b');
  for (const d of [chat, projA, projB]) fs.mkdirSync(d);
  const dir = path.join(tmp, 'projects', 'p');
  fs.mkdirSync(path.join(dir, 'C', 'subagents'), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'C.jsonl'), at('C', chat, now - 1000));
  fs.writeFileSync(path.join(dir, 'C', 'subagents', 'agent-x.jsonl'), at('C', chat, now - 500));
  fs.writeFileSync(path.join(dir, 'A.jsonl'), at('A', projA, now - 5000));
  fs.writeFileSync(path.join(dir, 'A2.jsonl'), at('A2', projA, now - 6000));
  fs.writeFileSync(path.join(dir, 'B.jsonl'), at('B', projB, now - 2000));
  fs.writeFileSync(path.join(dir, 'W.jsonl'), at('W', path.join(projA, '.claude', 'worktrees', 'x'), now));
  fs.writeFileSync(path.join(dir, 'G.jsonl'), at('G', path.join(tmp, 'disparu'), now));
  fs.writeFileSync(path.join(dir, 'N.jsonl'), JSON.stringify({ type: 'user', sessionId: 'N', cwd: chat, message: { content: 'sans date' } }) + '\n');
  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json'), chatDir: chat, limitsDir: path.join(tmp, 'limits') });
  store.scan();
  return { tmp, chat, projA, projB, dir, store };
}

test('recentDirs : du plus récent au plus ancien, dédoublonnés, sans discussion, worktree ni dossier disparu', () => {
  const { projA, projB, store } = chatFixture();
  const now = Date.now();
  const r = store.recentDirs();
  assert.deepEqual(r.map((x) => x.dir), [projB, projA]);
  // lastTs = le plus récent des transcripts du dossier (A à -5 s, A2 à -6 s)
  assert.ok(Math.abs(r[1].lastTs - (now - 5000)) < 1000, String(r[1].lastTs));
  assert.deepEqual(store.recentDirs(1).map((x) => x.dir), [projB]);
});

test('isChat : discussion par transcript (même sans date) ou par terminal ; jamais une session ordinaire', () => {
  const { tmp, chat, projA, store } = chatFixture();
  assert.equal(store.isChat('C', []), true);
  assert.equal(store.isChat('N', []), true);
  assert.equal(store.isChat('A', []), false);
  assert.equal(store.isChat('inconnue', []), false);
  // Discussion en attente (pas encore de transcript) : reconnue par son terminal, shell compris.
  assert.equal(store.isChat('P', [{ sessionId: 'P', kind: 'claude', cwd: chat }]), true);
  assert.equal(store.isChat('P', [{ sessionId: 'P', kind: 'shell', cwd: chat }]), true);
  assert.equal(store.isChat('P', [{ sessionId: 'P', kind: 'claude', cwd: projA }]), false);
  assert.equal(store.isChat('A', [{ sessionId: 'Z', kind: 'claude', cwd: chat }]), false);
  // Un transcript existant décide seul : un terminal de la session dans chatDir ne suffit pas à l'effacer.
  assert.equal(store.isChat('A', [{ sessionId: 'A', kind: 'shell', cwd: chat }]), false);
  assert.equal(store.isChat('C', [{ sessionId: 'C', kind: 'claude', cwd: projA }]), true);
  // Sans dossier de discussion, rien n'est une discussion (pas même une session au cwd inconnu).
  const plain = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  plain.scan();
  assert.equal(plain.isChat('C', []), false);
  assert.equal(plain.isChat('P', [{ sessionId: 'P', kind: 'claude', cwd: null }]), false);
});

test('cwdOf : transcript, sinon terminal claude en attente ; jamais un simple shell', () => {
  const { projA, projB, store } = chatFixture();
  assert.equal(store.cwdOf('A', []), projA);
  assert.equal(store.cwdOf('A', [{ sessionId: 'A', kind: 'claude', cwd: projB }]), projA); // le transcript prime
  assert.equal(store.cwdOf('P', [{ sessionId: 'P', kind: 'claude', cwd: projB }]), projB);
  assert.equal(store.cwdOf('P', [{ sessionId: 'P', kind: 'shell', cwd: projB }]), null);
  assert.equal(store.cwdOf('inconnue', []), null);
});

test('purgeChats : seules les discussions sont effacées du disque', () => {
  const { dir, store } = chatFixture();
  store.purgeChats();
  assert.deepEqual(fs.readdirSync(dir).sort(), ['A.jsonl', 'A2.jsonl', 'B.jsonl', 'G.jsonl', 'W.jsonl']);
  assert.equal(store.isChat('C', []), false);
});

test("isChat : un même id présent dans un vrai projet n'est jamais traité comme discussion", () => {
  const { tmp, chat, projA, store } = chatFixture();
  // Même id C copié dans un autre projet (resume depuis un autre dossier, copie de fichiers) : purge effacerait les deux.
  const other = path.join(tmp, 'projects', 'q');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'C.jsonl'), at('C', projA, Date.now() - 800));
  store.scan();
  assert.equal(store.isChat('C', [{ sessionId: 'C', kind: 'claude', cwd: chat }]), false);
});

test('idle : vrai au tour rendu ou terminé, faux au travail, en attente, avec un sous-agent actif ou inconnu', () => {
  const tmp = tempDir('vigie-idle-');
  const dir = path.join(tmp, 'p');
  const now = Date.now();
  fs.mkdirSync(path.join(dir, 'A', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'T.jsonl'), rec('T', now - 60_000)); // tour rendu
  fs.writeFileSync(path.join(dir, 'D.jsonl'), rec('D', now - 3_600_000)); // terminée
  fs.writeFileSync(path.join(dir, 'R.jsonl'), rec('R', now - 60_000, { pending: true })); // outil en cours
  fs.writeFileSync(path.join(dir, 'W.jsonl'), rec('W', now - 60_000));
  fs.writeFileSync(path.join(dir, 'A.jsonl'), rec('A', now - 60_000));
  fs.writeFileSync(path.join(dir, 'A', 'subagents', 'agent-a.jsonl'), rec('A', now - 30_000, { pending: true }));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  store.onHook({ session_id: 'W', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm' } });
  assert.deepEqual(['T', 'D', 'R', 'W', 'A', 'X'].map((id) => store.idle(id, [])), [true, true, false, false, false, false]);
  // Session lancée par Vigie sans transcript encore : comme pendingSummary.
  assert.equal(store.idle('X', [{ id: 't', sessionId: 'X', kind: 'claude', exited: false }]), true);
  assert.equal(store.idle('X', [{ id: 't', sessionId: 'X', kind: 'shell', exited: false }]), false);
});

// ── Historique de consommation (~/.vigie/usage.json) ─────────────────────
const usageCall = (ts, id, model, output, { sessionId = 'S', cwd = '/dev/revu', prompt } = {}) => (prompt ? JSON.stringify({
  type: 'user', timestamp: new Date(ts - 1).toISOString(), sessionId, cwd, message: { role: 'user', content: prompt },
}) + '\n' : '') + JSON.stringify({
  type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId, cwd,
  message: { id, model, stop_reason: 'end_turn', content: [], usage: { input_tokens: 0, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
}) + '\n';

function historyFixture() {
  const tmp = tempDir('vigie-history-');
  const projects = path.join(tmp, 'projects');
  fs.mkdirSync(path.join(projects, 'p'), { recursive: true });
  const historyFile = path.join(tmp, 'vigie', 'usage.json');
  const chatDir = path.join(tmp, 'chat');
  const make = () => { const s = createStore({ projectsDir: projects, hiddenFile: path.join(tmp, 'hidden.json'), chatDir, limitsDir: path.join(tmp, 'limits'), historyFile }); s.scan(); return s; };
  return { tmp, projects, dir: path.join(projects, 'p'), historyFile, chatDir, make };
}
const total = (u) => u.rows.reduce((n, r) => n + r.output, 0);

test('historique : enregistré puis relu sans double compte, conforme ; un transcript effacé reste dans l’historique', () => {
  const { dir, historyFile, make } = historyFixture();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'S.jsonl'), usageCall(now - 2000, 'a', 'claude-opus-5-5', 100) + usageCall(now - 1000, 'b', 'claude-opus-5-5', 20));
  fs.writeFileSync(path.join(dir, 'T.jsonl'), usageCall(now - 1000, 'c', 'claude-opus-5-5', 3, { sessionId: 'T' }));
  const first = make();
  first.saveHistory();
  assert.equal(JSON.parse(fs.readFileSync(historyFile, 'utf8')).v, 1);
  for (let i = 0; i < 2; i++) {
    const again = make();
    again.saveHistory();
    assert.equal(total(again.usageRows(now, 14)), 123);
  }
  fs.rmSync(path.join(dir, 'T.jsonl'));
  const after = make();
  const u = after.usageRows(now, 90);
  conforme(C.UsageRows, u);
  assert.deepEqual(u.rows.map((r) => [r.sessionId, r.output]).sort(), [['S', 120], ['T', 3]]);
});

test('historique : fichier illisible mis de côté (jamais écrasé), premier scan sur 31 jours puis 14', () => {
  const { dir, historyFile, make } = historyFixture();
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, '{"v":1,"rows":[');
  const old = Date.now() - 20 * 86_400_000;
  const f = path.join(dir, 'Old.jsonl');
  fs.writeFileSync(f, usageCall(old, 'o', 'claude-opus-5-5', 7, { sessionId: 'Old' }));
  fs.utimesSync(f, old / 1000, old / 1000);
  const store = make(); // historique illisible = pas d'historique : amorçage sur 31 jours
  const aside = fs.readdirSync(path.dirname(historyFile)).filter((n) => n.startsWith('usage.json.corrupt-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(historyFile), aside[0]), 'utf8'), '{"v":1,"rows":[');
  assert.equal(total(store.usageRows(Date.now(), 31)), 7);
  // Scans suivants : 14 jours, un vieux transcript apparu entre-temps n'est pas lu.
  const g = path.join(dir, 'Old2.jsonl');
  fs.writeFileSync(g, usageCall(old, 'p', 'claude-opus-5-5', 5, { sessionId: 'Old2' }));
  fs.utimesSync(g, old / 1000, old / 1000);
  store.scan();
  assert.equal(total(store.usageRows(Date.now(), 31)), 7);
  // Historique présent : redémarrage sur 14 jours, les lignes archivées restent servies.
  store.saveHistory();
  const next = make();
  assert.equal(total(next.usageRows(Date.now(), 31)), 7);
  assert.equal([...next.tracks.keys()].some((k) => k.endsWith('Old.jsonl')), false);
});

test('historique : la consommation d’une discussion purgée reste, sans aucun texte de la discussion', () => {
  const { dir, historyFile, chatDir, make } = historyFixture();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'K.jsonl'), usageCall(now - 1000, 'k', 'claude-opus-5-5', 42, { sessionId: 'K', cwd: chatDir, prompt: 'secret-du-prompt' }));
  const store = make();
  assert.equal(store.isChat('K', []), true);
  store.purge('K');
  const raw = fs.readFileSync(historyFile, 'utf8');
  assert.equal(raw.includes('secret-du-prompt'), false);
  const rows = make().usageRows(now, 14).rows;
  assert.deepEqual(rows.map((r) => [r.sessionId, r.title, r.project, r.output]), [['K', '(discussion)', 'discussion', 42]]);
});

test('historique : fenêtre de 5 h close avec son % réel, gardée après redémarrage et ménage des relevés', () => {
  const { tmp, dir, make } = historyFixture();
  const H = 3_600_000;
  const now = Date.now();
  const start = Math.floor((now - 10 * H) / H) * H; // bloc clos depuis 5 h
  fs.writeFileSync(path.join(dir, 'S.jsonl'), usageCall(start + 60_000, 'a', 'claude-opus-5-5', 1e6));
  const limits = path.join(tmp, 'limits');
  fs.mkdirSync(limits, { recursive: true });
  fs.writeFileSync(path.join(limits, 'S.json'), JSON.stringify({ ts: start + 2 * H, rate_limits: { five_hour: { used_percentage: 61, resets_at: (start + 5 * H) / 1000 } } }));
  const store = make();
  const w = store.usageRows(now, 14).windows;
  assert.deepEqual(w, [{ start, end: start + 5 * H, tokens: 1e6, cost: 20, pct: 0.61 }]);
  store.saveHistory();
  fs.rmSync(limits, { recursive: true }); // relevé effacé (ménage d'un jour)
  conforme(C.UsageRows, make().usageRows(now, 14));
  assert.deepEqual(make().usageRows(now, 14).windows, w);
});

test('coût d’une session : série par agent et coût par agent égaux au coût total, conformes ; null si inconnue', () => {
  const { dir, make } = historyFixture();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'S.jsonl'), usageCall(now - 600_000, 'a', 'claude-opus-5-5', 1e6) + usageCall(now - 1000, 'b', 'claude-sonnet-5-5', 3e5));
  fs.mkdirSync(path.join(dir, 'S', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'S', 'subagents', 'agent-x.jsonl'), usageCall(now - 300_000, 'c', 'claude-haiku-5', 2e6));
  const store = make();
  const d = store.detail('S', []);
  conforme(C.SessionDetail, d);
  const cost = store.sessionCost('S');
  conforme(C.SessionCost, cost);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(cost.points.reduce((n, p) => n + p.cost, 0), d.summary.cost);
  near(d.agents.reduce((n, a) => n + a.cost, 0), d.summary.cost);
  assert.deepEqual([...new Set(cost.points.map((p) => p.agent))], d.agents.map((a) => a.id));
  assert.equal(store.sessionCost('inconnue'), null);
});

test('historique : aucun début de prompt archivé, fichier non réécrit sans changement', () => {
  const { dir, historyFile, make } = historyFixture();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'S.jsonl'), usageCall(now - 1000, 'a', 'claude-opus-5-5', 5, { prompt: 'jeton-colle-dans-le-prompt' }));
  const store = make();
  assert.equal(store.usageRows(now, 14).rows[0].title, 'jeton-colle-dans-le-prompt'); // affichage : repli sur le prompt, en mémoire
  store.saveHistory();
  assert.equal(fs.readFileSync(historyFile, 'utf8').includes('jeton-colle'), false);
  fs.writeFileSync(historyFile, '{"v":1,"rows":[],"windows":[]}'); // témoin : réécrit seulement s'il y a du neuf
  store.scan();
  store.saveHistory();
  assert.equal(fs.readFileSync(historyFile, 'utf8'), '{"v":1,"rows":[],"windows":[]}');
  fs.appendFileSync(path.join(dir, 'S.jsonl'), usageCall(now - 500, 'b', 'claude-opus-5-5', 1));
  store.scan();
  store.saveHistory();
  assert.equal(JSON.parse(fs.readFileSync(historyFile, 'utf8')).rows[0].output, 6);
});

test('historique : plus de la moitié des lignes illisibles → mis de côté, pas écrasé', () => {
  const { historyFile, make } = historyFixture();
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  const bad = JSON.stringify({ v: 1, rows: [{ day: 'x' }, { day: 'y' }], windows: [] });
  fs.writeFileSync(historyFile, bad);
  make().saveHistory();
  const aside = fs.readdirSync(path.dirname(historyFile)).find((n) => n.startsWith('usage.json.corrupt-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(historyFile), aside), 'utf8'), bad);
});

test('toolPath : chemin complet du fichier de l’outil en cours, null pour un outil sans fichier', () => {
  const tmp = tempDir('vigie-toolpath-');
  const dir = path.join(tmp, 'p');
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now() - 60_000;
  const rec = (s, o) => JSON.stringify({ timestamp: new Date(t0 + s * 1000).toISOString(), sessionId: 'S', cwd: '/dev/revu', ...o }) + '\n';
  const tool = (s, id, name, input) => rec(s, { type: 'assistant', message: { id: `m${s}`, content: [{ type: 'tool_use', id, name, input }] } });
  const file = path.join(dir, 'S.jsonl');
  fs.writeFileSync(file, rec(0, { type: 'user', message: { content: 'go' } }) + tool(1, 'r1', 'Edit', { file_path: '/dev/revu/src/deep/a.ts' }));
  const store = createStore({ projectsDir: tmp, hiddenFile: path.join(tmp, 'hidden.json'), limitsDir: path.join(tmp, 'limits') });
  store.scan();
  const get = () => { const snap = store.snapshot([]); conforme(C.Snapshot, snap); return snap.sessions.find((s) => s.id === 'S'); };
  assert.deepEqual([get().tool, get().toolPath], ['Edit · deep/a.ts','/dev/revu/src/deep/a.ts']);
  fs.appendFileSync(file, tool(2, 'b1', 'Bash', { command: 'npm test' }));
  store.scan();
  assert.equal(get().toolPath, null);
});
