// node --test daemon/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRecord, batchWatch, deriveState, excerpt, newTrack, readTrack, trackTokens } from './ingest.mjs';
import { buildTrace } from './trace.mjs';
import { SessionTrace } from '../contract/index.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

const T0 = Date.parse('2026-11-07T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const usage = { input_tokens: 2, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 9000 };

// Lignes au format réel de Claude Code 2.1 (un message assistant découpé en plusieurs lignes).
const LINES = [
  { type: 'queue-operation', operation: 'enqueue', timestamp: at(0) },
  { type: 'user', timestamp: at(0), sessionId: 'S', cwd: '/dev/meeplebox', gitBranch: 'feat/x', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: 'ajoute des tests' }] } },
  { type: 'ai-title', aiTitle: 'Tests du moteur', sessionId: 'S' },
  { type: 'assistant', timestamp: at(5), sessionId: 'S', message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage, content: [{ type: 'text', text: 'Je lance les tests.' }] } },
  { type: 'assistant', timestamp: at(5), sessionId: 'S', message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } },
  { type: 'user', timestamp: at(20), sessionId: 'S', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] } },
  { type: 'assistant', timestamp: at(25), sessionId: 'S', message: { id: 'm2', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Tests verts.' }] } },
];

function trackFrom(lines) {
  const t = newTrack('x.jsonl');
  for (const l of lines) applyRecord(t, l);
  return t;
}

test('décode titre, projet, outils et dernier message', () => {
  const t = trackFrom(LINES);
  assert.equal(t.title, 'Tests du moteur');
  assert.equal(t.cwd, '/dev/meeplebox');
  assert.equal(t.branch, 'feat/x');
  assert.equal(t.lastText, 'Tests verts.');
  const tool = t.tools.get('tu1');
  assert.equal(tool.label, 'npm test');
  assert.equal(tool.end - tool.start, 15_000);
  assert.equal(t.pending, null);
});

test("dédoublonne l'usage répété sur les lignes d'un même message", () => {
  const { total, cacheRate } = trackTokens(trackFrom(LINES));
  assert.equal(total, 2 * (2 + 100 + 1000 + 9000));
  assert.equal(cacheRate, 9000 / 10002);
});

test('états : fin de tour → à toi, puis terminé après 30 min', () => {
  const t = trackFrom(LINES);
  assert.equal(deriveState(t, T0 + 60_000).state, 'turn');
  assert.equal(deriveState(t, T0 + 45 * 60_000).state, 'done');
});

test('états : outil en cours, question ouverte', () => {
  const running = trackFrom(LINES.slice(0, 5));
  assert.equal(deriveState(running, T0 + 10_000).state, 'running');
  const asking = trackFrom([...LINES.slice(0, 2), { type: 'assistant', timestamp: at(5), message: { id: 'm9', content: [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [{ question: 'Imports ou nommage ?' }] } }] } }]);
  assert.deepEqual(deriveState(asking, T0 + 10_000), { state: 'waiting', reason: 'question', detail: 'Imports ou nommage ?' });
});

test("les hooks priment sur le transcript : demande d'autorisation", () => {
  const t = trackFrom(LINES.slice(0, 5));
  const live = { event: 'PermissionRequest', ts: T0 + 6000, detail: 'Bash · npm test' };
  assert.deepEqual(deriveState(t, T0 + 10_000, live), { state: 'waiting', reason: 'permission', detail: 'Bash · npm test' });
  // Un hook plus ancien que le transcript est périmé.
  assert.equal(deriveState(trackFrom(LINES), T0 + 30_000, { event: 'PreToolUse', ts: T0 }).state, 'turn');
});

// Échap dans Claude Code : forme relevée dans de vrais transcripts (message « user », seul bloc texte, aucun hook Stop).
const interrupt = (s, forTool = false, extra = {}) => ({ type: 'user', timestamp: at(s), sessionId: 'S', ...extra, message: { role: 'user', content: [{ type: 'text', text: `[Request interrupted by user${forTool ? ' for tool use' : ''}]` }] } });

test('interruption pendant une réponse : à toi (plus « en cours » 10 min), pas un message de l’humain', () => {
  const t = trackFrom([...LINES.slice(0, 2), interrupt(8)]);
  assert.equal(deriveState(t, T0 + 10_000).state, 'turn');
  assert.equal(deriveState(t, T0 + 45 * 60_000).state, 'done');
  assert.deepEqual(t.prompts.map((p) => p.text), ['ajoute des tests']);
  assert.equal(t.firstPrompt, 'ajoute des tests');
  // Un nouveau message de l'humain relance le tour.
  applyRecord(t, { type: 'user', timestamp: at(30), sessionId: 'S', message: { content: 'reprends' } });
  assert.equal(deriveState(t, T0 + 31_000).state, 'running');
});

test('interruption d’un outil sans résultat : outil clos et marqué interrompu, à toi, sans « souci »', () => {
  // Claude Code écrit d'abord le refus de l'outil en erreur (forme réelle), puis le marqueur.
  const refused = { type: 'user', timestamp: at(8), sessionId: 'S', message: { content: [{ type: 'tool_result', tool_use_id: 'tu0', is_error: true, content: 'refusé' }] } };
  const t = trackFrom([...LINES.slice(0, 5), refused, interrupt(9, true)]);
  assert.equal(t.lastError, null);
  assert.equal(t.pending, null);
  assert.deepEqual([t.tools.get('tu1').end, t.tools.get('tu1').interrupted], [T0 + 9000, true]);
  assert.equal(deriveState(t, T0 + 10_000).state, 'turn');
  const trace = buildTrace({ main: t, subs: [], summary: { state: 'turn', lastTs: t.lastTs }, now: T0 + 10_000 });
  assert.deepEqual(trace.turns[0].steps.map((x) => [x.end, x.interrupted]), [[T0 + 9000, true]]);
  // Conforme : `interrupted` toujours émis (booléen requis par le contrat).
  const j = JSON.parse(JSON.stringify(trace));
  assert.deepStrictEqual(SessionTrace.parse(j), j);
  delete j.turns[0].steps[0].interrupted;
  assert.equal(SessionTrace.safeParse(j).success, false);
});

test('interruption : un hook d’avant (PreToolUse à moins de 2 s) ne la masque pas ; un hook d’après compte', () => {
  const t = trackFrom([...LINES.slice(0, 5), interrupt(6, true)]);
  assert.equal(deriveState(t, T0 + 7000, { event: 'PreToolUse', ts: T0 + 5500 }).state, 'turn');
  assert.equal(deriveState(t, T0 + 7000, { event: 'PreToolUse', ts: T0 + 6000 }).state, 'turn'); // même milliseconde
  assert.equal(deriveState(t, T0 + 8000, { event: 'UserPromptSubmit', ts: T0 + 7000 }).state, 'running');
});

test('interruption d’un sous-agent (isSidechain) : à toi, plus compté actif', () => {
  const sub = trackFrom([
    { type: 'user', timestamp: at(0), sessionId: 'S', isSidechain: true, message: { content: 'cherche les tests' } },
    { type: 'assistant', timestamp: at(1), sessionId: 'S', isSidechain: true, message: { id: 'a1', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'x' } }] } },
    interrupt(2, false, { isSidechain: true }),
  ]);
  assert.equal(deriveState(sub, T0 + 3000).state, 'turn');
  assert.equal(sub.firstPrompt, 'cherche les tests');
});

test('le marqueur tapé à la main (promptSource) reste un message de l’humain', () => {
  const typed = { type: 'user', timestamp: at(8), sessionId: 'S', promptSource: 'user', message: { content: '[Request interrupted by user]' } };
  const t = trackFrom([...LINES.slice(0, 2), typed]);
  assert.equal(t.lastStop, null);
  assert.equal(t.interruptTs, 0);
  assert.deepEqual(t.prompts.map((p) => p.text), ['ajoute des tests', '[Request interrupted by user]']);
  assert.equal(deriveState(t, T0 + 9000).state, 'running');
});

test('un texte qui ressemble au marqueur sans l’être reste un message de l’humain', () => {
  const t = trackFrom([...LINES.slice(0, 2), interrupt(8), { type: 'user', timestamp: at(9), sessionId: 'S', message: { content: '[Request interrupted by user] ? que veut dire ce message' } }]);
  assert.equal(t.lastStop, null);
  assert.equal(t.prompts.length, 2);
});

test('lecture incrémentale : une ligne coupée est reprise au passage suivant', () => {
  const file = path.join(tempDir('vigie-'), 's.jsonl');
  const text = LINES.map((l) => JSON.stringify(l)).join('\n') + '\n';
  const cut = text.length - 30;
  fs.writeFileSync(file, text.slice(0, cut));
  const t = newTrack(file);
  readTrack(t);
  assert.equal(t.lastStop, 'tool_use');
  fs.appendFileSync(file, text.slice(cut));
  readTrack(t);
  assert.equal(t.lastStop, 'end_turn');
});

test('vrais transcripts : décodage sans erreur', { skip: !fs.existsSync(path.join(os.homedir(), '.claude', 'projects')) }, () => {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const files = fs.readdirSync(root).flatMap((d) => {
    try { return fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(root, d, f)); } catch { return []; }
  }).slice(0, 50);
  for (const f of files) {
    const t = newTrack(f);
    readTrack(t);
    assert.ok(t.offset > 0 || fs.statSync(f).size === 0, f);
  }
});

test('plan : dernier ExitPlanMode non vide retenu, input {} ou plan blanc ignorés', () => {
  const plan = (s, id, input) => ({ type: 'assistant', timestamp: at(s), sessionId: 'S', message: { id, content: [{ type: 'tool_use', id: `p${id}`, name: 'ExitPlanMode', input }] } });
  assert.equal(trackFrom(LINES).plan, null);
  const t = trackFrom([...LINES, plan(30, 'a', { plan: '# Plan A' }), plan(31, 'b', {}), plan(32, 'c', { plan: '  ' })]);
  assert.deepEqual(t.plan, { text: '# Plan A', ts: T0 + 30_000 });
  assert.deepEqual(trackFrom([...LINES, plan(30, 'a', { plan: '# Plan A' }), plan(40, 'd', { plan: '# Plan B' })]).plan, { text: '# Plan B', ts: T0 + 40_000 });
});

test('plan : input {} (Claude Code ≥ 2.1.326) = dernier fichier plans/*.md écrit puis édité', () => {
  const use = (s, id, name, input) => ({ type: 'assistant', timestamp: at(s), sessionId: 'S', message: { id, content: [{ type: 'tool_use', id: `u${id}`, name, input }] } });
  const file = path.join(path.sep, 'h', '.claude', 'plans', 'x.md');
  const other = path.join(path.sep, 'p', 'notes.md');
  assert.equal(trackFrom([...LINES, use(30, 'a', 'ExitPlanMode', {})]).plan, null);
  const t = trackFrom([...LINES,
    use(30, 'a', 'Write', { file_path: file, content: '# Plan\n- a $& b\n- a' }),
    use(31, 'b', 'Edit', { file_path: file, old_string: '- a', new_string: '- c $&' }),
    use(32, 'c', 'Write', { file_path: other, content: 'pas un plan' }),
    use(33, 'd', 'ExitPlanMode', {}),
  ]);
  assert.deepEqual(t.plan, { text: '# Plan\n- c $& $& b\n- a', ts: T0 + 33_000 });
});

test('batchWatch : un lot 250 ms après le premier événement, noms accumulés, sans nom = scan complet', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = path.join(path.sep, 'p');
  const lots = [];
  const on = batchWatch(dir, (b) => lots.push(b));
  on('change', 'a.jsonl');
  t.mock.timers.tick(200);
  on('change', path.join('S', 'subagents', 'x.jsonl'));
  on('change', 'a.jsonl');
  t.mock.timers.tick(49);
  assert.equal(lots.length, 0);
  t.mock.timers.tick(1); // 250 ms après le premier : pas repoussé par les suivants
  assert.deepEqual(lots, [{ files: [path.join(dir, 'a.jsonl'), path.join(dir, 'S', 'subagents', 'x.jsonl')], full: false }]);
  on('rename', null);
  on('change', Buffer.from('b.jsonl')); // fs.watch peut rendre un Buffer
  t.mock.timers.tick(250);
  assert.deepEqual(lots[1], { files: [path.join(dir, 'b.jsonl')], full: true });
});

test('excerpt : ≤ 200 caractères autour du terme, sans déborder de la ligne', () => {
  const found = (line, q) => excerpt(line, line.indexOf(q), q.length);
  assert.deepEqual(found('un mot court', 'mot'), { text: 'un mot court', at: 3 }); // ligne courte : entière
  const start = found('CIBLE' + 'z'.repeat(500), 'CIBLE');
  assert.deepEqual([start.text, start.at], ['CIBLE' + 'z'.repeat(195), 0]); // début : pas d'avant
  const end = found('a'.repeat(500) + 'CIBLE', 'CIBLE');
  assert.deepEqual([end.text, end.at], ['a'.repeat(195) + 'CIBLE', 195]); // fin : la ligne finit l'extrait
  const mid = found('a'.repeat(500) + 'CIBLE' + 'z'.repeat(500), 'CIBLE');
  assert.equal(mid.text.length, 200);
  assert.equal(mid.at, 97); // centré : (200 − 5) >> 1 caractères avant
  assert.equal(mid.text.slice(mid.at, mid.at + 5), 'CIBLE');
});
