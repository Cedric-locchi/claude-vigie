// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeCommand, hooksSettings, httpHooksAllowed, limitsReading, nodeCommand, spoolLine, userStatusLine } from './launch.mjs';

const F = '/h/.vigie/hooks.json';
const U = '0b3f9c2e-1a2b-4c3d-8e9f-0123456789ab';
const run = (cmd, file = F) => claudeCommand(cmd, file, () => 'X');

test('claude seul : id fixé et hooks branchés', () => {
  assert.deepEqual(run('claude'), { sessionId: 'X', command: `claude --session-id X --settings '${F}'` });
  assert.deepEqual(run(''), run('claude'));
  assert.deepEqual(run(undefined), run('claude'));
});

test('reprise avec id : on garde le sien, sans --session-id', () => {
  for (const c of [`claude --resume ${U}`, `claude -r ${U}`, `claude --resume=${U}`]) {
    const r = run(c);
    assert.equal(r.sessionId, U, c);
    assert.ok(!r.command.includes('--session-id'), r.command);
    assert.ok(r.command.startsWith(`claude --settings '${F}'`), r.command);
  }
});

test('--continue ou --resume sans id : fork vers notre id', () => {
  for (const c of ['claude --continue', 'claude -c', 'claude --resume']) {
    assert.ok(run(c).command.startsWith(`claude --session-id X --fork-session --settings '${F}'`), c);
  }
});

test('claude après && : injection après le &&, le -c de git n’est pas un --continue', () => {
  assert.deepEqual(run('git switch -c x && claude'), { sessionId: 'X', command: `git switch -c x && claude --session-id X --settings '${F}'` });
});

test('commande sans claude : inchangée ; chemin de hooks avec apostrophe échappé', () => {
  assert.equal(run('npm test').command, 'npm test');
  assert.equal(run('claude', "/h/l'app/hooks.json").command, `claude --session-id X --settings '/h/l'\\''app/hooks.json'`);
});

test('hooksSettings : 8 événements, matcher * sur les outils, statusline vers statusline.mjs', () => {
  const s = hooksSettings("'/usr/bin/node'", '/app/daemon');
  const hook = { type: 'command', command: "'/usr/bin/node' '/app/daemon/hook.mjs'", timeout: 5 };
  assert.deepEqual(s.statusLine, { type: 'command', command: "'/usr/bin/node' '/app/daemon/statusline.mjs'" });
  assert.deepEqual(Object.keys(s.hooks), ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd']);
  for (const [event, list] of Object.entries(s.hooks)) {
    const tool = ['PreToolUse', 'PostToolUse', 'PermissionRequest'].includes(event);
    assert.deepEqual(list, [tool ? { matcher: '*', hooks: [hook] } : { hooks: [hook] }], event);
  }
});

test('hooksSettings : chemin avec $, backtick ou apostrophe quoté pour le shell (rien de développé)', () => {
  const s = hooksSettings("'/n'", "/Users/x/$HOME/`id`/l'app");
  assert.equal(s.statusLine.command, `'/n' '/Users/x/$HOME/\`id\`/l'\\''app/statusline.mjs'`);
});

test('nodeCommand : node du daemon, sinon du PATH ; dans Electron, PATH puis ELECTRON_RUN_AS_NODE avec le binaire de l’app', () => {
  let asked = 0;
  const pathNode = (f) => () => { asked++; return f; };
  assert.equal(nodeCommand({ electron: false, execPath: '/opt/node', execOk: true, pathNode: pathNode('/usr/bin/node') }), "'/opt/node'");
  assert.equal(asked, 0); // node du daemon encore là : pas de `node --version`
  assert.equal(nodeCommand({ electron: false, execPath: '/disparu/node', execOk: false, pathNode: pathNode('/usr/bin/node') }), "'/usr/bin/node'");
  assert.equal(nodeCommand({ electron: false, execPath: '/disparu/node', execOk: false, pathNode: pathNode(null) }), "'/disparu/node'");
  assert.equal(nodeCommand({ electron: true, execPath: '/App/Helper', vigieNode: '/App/Vigie', pathNode: pathNode('/usr/bin/node') }), "'/usr/bin/node'");
  assert.equal(nodeCommand({ electron: true, execPath: '/App/Helper', vigieNode: '/App/Vigie', pathNode: pathNode(null) }), "ELECTRON_RUN_AS_NODE=1 '/App/Vigie'");
  assert.equal(nodeCommand({ electron: true, execPath: "/A p/l'app", vigieNode: '', pathNode: pathNode(null) }), "ELECTRON_RUN_AS_NODE=1 '/A p/l'\\''app'");
});

test('statusline : commande de l’utilisateur (~/ développé), relevé gardé seulement avec quota ou contexte, id nettoyé', () => {
  assert.equal(userStatusLine({ statusLine: { command: '~/bin/line --x' } }, '/h'), '/h/bin/line --x');
  assert.equal(userStatusLine({ statusLine: { command: 'line' } }, '/h'), 'line');
  for (const s of [null, {}, { statusLine: {} }, { statusLine: { command: '  ' } }, { statusLine: { command: 42 } }]) assert.equal(userStatusLine(s, '/h'), null);
  assert.equal(limitsReading({ session_id: 's' }, 1), null);
  assert.equal(limitsReading(null, 1), null);
  assert.equal(limitsReading('texte', 1), null);
  const rl = { five_hour: { used_percentage: 12, resets_at: 9 } };
  assert.deepEqual(limitsReading({ session_id: '../../x y', rate_limits: rl, model: 'm' }, 7), { name: 'xy.json', data: { ts: 7, rate_limits: rl, context_window: undefined } });
  assert.equal(limitsReading({ session_id: '../', context_window: { context_window_size: 1 } }, 7).name, 'inconnue.json');
});

test('hooksSettings avec hookUrl : hooks HTTP vers le daemon, statusline inchangée', () => {
  const s = hooksSettings("'/usr/bin/node'", '/app/daemon', 'http://127.0.0.1:4317/api/hook');
  assert.deepEqual(s.hooks.PreToolUse, [{ matcher: '*', hooks: [{ type: 'http', url: 'http://127.0.0.1:4317/api/hook', timeout: 5 }] }]);
  assert.equal(s.statusLine.type, 'command');
});

test('httpHooksAllowed : sans liste tout passe ; liste vide ou sans motif couvrant : refusé', () => {
  const url = 'http://127.0.0.1:4317/api/hook';
  assert.equal(httpHooksAllowed(null, url), true);
  assert.equal(httpHooksAllowed({}, url), true);
  assert.equal(httpHooksAllowed({ allowedHttpHookUrls: [] }, url), false);
  assert.equal(httpHooksAllowed({ allowedHttpHookUrls: ['https://hooks.example.com/*'] }, url), false);
  assert.equal(httpHooksAllowed({ allowedHttpHookUrls: ['http://127.0.0.1:*'] }, url), true);
});

test('spoolLine : garde les champs utiles, jamais le contenu des outils', () => {
  const l = spoolLine({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/a', content: 'secret' }, tool_response: 'x' }, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(l)), { ts: 1, session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/a' } });
});
