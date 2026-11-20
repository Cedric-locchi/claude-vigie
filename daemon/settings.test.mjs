// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keepBooleanPlugins, readSettings, writeSettings } from './settings.mjs';
import { SettingsFile } from '../contract/index.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

test('keepBooleanPlugins : seules les entrées booléennes de plugins restent ; sans plugins, objet inchangé', () => {
  assert.deepEqual(keepBooleanPlugins({ locale: null, plugins: { mise: true, nx: 'oui', npm: false, x: null } }), { locale: null, plugins: { mise: true, npm: false } });
  for (const p of [null, [], 'mise', 3]) assert.deepEqual(keepBooleanPlugins({ plugins: p }), { plugins: {} }, JSON.stringify(p));
  const raw = { locale: 'fr_FR.UTF-8' };
  assert.equal(keepBooleanPlugins(raw), raw);
  assert.equal(keepBooleanPlugins(null), null);
});

test('readSettings / writeSettings : aller-retour, fichier absent, JSON tronqué ou hors contrat → défaut ; écriture sans .tmp restant', () => {
  const dir = tempDir('vigie-settings-');
  const file = path.join(dir, 'settings.json');
  assert.deepEqual(readSettings(file, SettingsFile), { locale: null });
  const s = { locale: 'fr_FR.UTF-8', alerts: { dailyCost: 10, windowPct: null }, plugins: { mise: true } };
  writeSettings(file, s);
  assert.deepEqual(readSettings(file, SettingsFile), s);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  fs.writeFileSync(file, '{"locale": "fr_');
  assert.deepEqual(readSettings(file, SettingsFile), { locale: null });
  fs.writeFileSync(file, JSON.stringify({ locale: 'pas une locale !' }));
  assert.deepEqual(readSettings(file, SettingsFile), { locale: null });
  // Une entrée de plugin invalide ne fait pas perdre la locale.
  fs.writeFileSync(file, JSON.stringify({ locale: 'C', plugins: { mise: 'oui', nx: true } }));
  assert.deepEqual(readSettings(file, SettingsFile), { locale: 'C', plugins: { nx: true } });
  writeSettings(null, s); // sans fichier : rien
  assert.deepEqual(readSettings(null, SettingsFile), { locale: null });
});
