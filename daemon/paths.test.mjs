// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { claudeConfigDir, claudeConfigPaths, claudeJsonFile, expandHome, isInside, tildePath } from './paths.mjs';

const H = path.join(path.sep, 'Users', 'x');
const j = (...p) => path.join(H, ...p);

test('expandHome : ~ et ~/… seulement, séparateur final gardé ; ~autre et chemins ordinaires inchangés', () => {
  assert.equal(expandHome('~', H), H);
  assert.equal(expandHome(`~${path.sep}proj`, H), j('proj'));
  assert.equal(expandHome(`~${path.sep}proj${path.sep}`, H), j('proj') + path.sep);
  assert.equal(expandHome('~autre/proj', H), '~autre/proj');
  assert.equal(expandHome('/tmp/~', H), '/tmp/~');
  assert.equal(expandHome('', H), '');
});

test('tildePath : sous home → ~/… ; home → ~ ; un voisin au nom plus long reste absolu', () => {
  assert.equal(tildePath(j('proj'), H), `~${path.sep}proj`);
  assert.equal(tildePath(H, H), '~');
  assert.equal(tildePath(H + '2' + path.sep + 'proj', H), H + '2' + path.sep + 'proj'); // /Users/x2/… n'est pas sous /Users/x
  assert.equal(tildePath('/etc/hosts', H), '/etc/hosts');
  assert.equal(expandHome(tildePath(j('a', 'b'), H), H), j('a', 'b'));
});

test('claudeConfigDir : CLAUDE_CONFIG_DIR (résolu, ~ développé) sinon ~/.claude ; claudeConfigPaths : ~/.claude, ~/.claude.json, le dossier choisi', () => {
  assert.equal(claudeConfigDir({ home: H }), j('.claude'));
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: '' }, home: H }), j('.claude'));
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: '/cfg/claude/' }, home: H }), path.resolve('/cfg/claude'));
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: `~${path.sep}cc` }, home: H }), j('cc'));
  assert.deepEqual(claudeConfigPaths({ home: H }), [j('.claude'), j('.claude.json')]);
  assert.deepEqual(claudeConfigPaths({ env: { CLAUDE_CONFIG_DIR: '/cfg' }, home: H }), [j('.claude'), j('.claude.json'), path.resolve('/cfg')]);
});

test('claudeJsonFile : ~/.claude.json, ou dans CLAUDE_CONFIG_DIR quand il est défini (toujours couvert par claudeConfigPaths)', () => {
  assert.equal(claudeJsonFile({ home: H }), j('.claude.json'));
  assert.equal(claudeJsonFile({ env: { CLAUDE_CONFIG_DIR: '' }, home: H }), j('.claude.json'));
  const env = { CLAUDE_CONFIG_DIR: `~${path.sep}cc` };
  assert.equal(claudeJsonFile({ env, home: H }), j('cc', '.claude.json'));
  assert.ok(claudeConfigPaths({ env, home: H }).some((p) => isInside(claudeJsonFile({ env, home: H }), p)));
});

test('isInside : le dossier lui-même et ses descendants ; ni le parent, ni un voisin au même préfixe', () => {
  assert.equal(isInside(j('.claude'), j('.claude')), true);
  assert.equal(isInside(j('.claude', 'settings.json'), j('.claude')), true);
  assert.equal(isInside(j('.claude-autre', 'x'), j('.claude')), false);
  assert.equal(isInside(H, j('.claude')), false);
  assert.equal(isInside(j('.claude.json'), j('.claude.json')), true);
});
