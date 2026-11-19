// node --test daemon/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRecord, deriveState, newTrack, readTrack, trackTokens } from './ingest.mjs';
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
