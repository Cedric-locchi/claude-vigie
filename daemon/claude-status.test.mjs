// node --test daemon/*.test.mjs
// Aucun réseau : seul parseStatus est testé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus, STATUS_PAGE } from './claude-status.mjs';
import * as C from '../contract/index.mjs';

// Sortie conforme au contrat : parse retire les clés inconnues, donc l'égalité échoue sur un champ manquant comme sur un champ en trop.
const conforme = (S, v) => { const j = JSON.parse(JSON.stringify(v)); assert.deepStrictEqual(S.parse(j), j); };
const vide = { indicator: 'unknown', incidents: [] };

test('nominal : indicateur et incidents, conforme au contrat', () => {
  const out = parseStatus({
    status: { indicator: 'major', description: 'x' },
    incidents: [{ name: 'API lente', shortlink: 'https://stspg.io/abc', id: '1' }, { name: 'Sans lien' }],
  });
  assert.deepEqual(out, { indicator: 'major', incidents: [
    { name: 'API lente', url: 'https://stspg.io/abc' },
    { name: 'Sans lien', url: STATUS_PAGE },
  ] });
  conforme(C.ClaudeStatus, out);
});

test('indicateur inconnu ou absent → unknown', () => {
  assert.equal(parseStatus({ status: { indicator: 'boom' } }).indicator, 'unknown');
  assert.equal(parseStatus({ status: {} }).indicator, 'unknown');
  assert.equal(parseStatus({ incidents: [] }).indicator, 'unknown');
});

test('entrée invalide → valeur vide', () => {
  for (const x of [null, undefined, 'x', 42, {}]) assert.deepEqual(parseStatus(x), vide);
  conforme(C.ClaudeStatus, parseStatus(null));
});

test('incidents bornés : 5 au plus, nom tronqué à 200, nom absent ignoré', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `i${i}` }));
  assert.equal(parseStatus({ incidents: many }).incidents.length, 5);
  const [one] = parseStatus({ incidents: [{ name: 'a'.repeat(1000) }] }).incidents;
  assert.equal(one.name.length, 200);
  assert.deepEqual(parseStatus({ incidents: [null, { name: 3 }, {}, { name: 'ok' }] }).incidents, [{ name: 'ok', url: STATUS_PAGE }]);
  assert.deepEqual(parseStatus({ incidents: 'nope' }).incidents, []);
});

test('lien : https vers status.claude.com ou stspg.io seulement', () => {
  const url = (shortlink) => parseStatus({ incidents: [{ name: 'n', shortlink }] }).incidents[0].url;
  for (const bad of ['javascript:alert(1)', 'http://stspg.io/abc', 'https://evil.example/abc', 'pas une url', 42])
    assert.equal(url(bad), STATUS_PAGE, String(bad));
  assert.equal(url('https://stspg.io/abc'), 'https://stspg.io/abc');
  assert.equal(url('https://status.claude.com/incidents/x'), 'https://status.claude.com/incidents/x');
});
