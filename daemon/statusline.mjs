#!/usr/bin/env node
// Statusline relais (sessions lancées par Vigie) : Claude Code y passe les vraies limites de quota
// (rate_limits), qu'on garde pour la carte de monitoring, puis on rend la main à la statusline
// habituelle de l'utilisateur avec la même entrée. Logique pure dans launch.mjs (userStatusLine, limitsReading), testée.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { limitsReading, userStatusLine } from './launch.mjs';
import { claudeConfigDir } from './paths.mjs';

const home = os.homedir();
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const cmd = userStatusLine(JSON.parse(fs.readFileSync(path.join(claudeConfigDir({ env: process.env, home }), 'settings.json'), 'utf8')), home);
    if (cmd) process.stdout.write(execSync(cmd, { input: raw, shell: 'bash', timeout: 4000 }));
  } catch { /* pas de statusline utilisateur, ou elle a échoué */ }
  // Après la statusline de l'utilisateur : la sienne peut écrire le même fichier, sans context_window.
  try {
    const r = limitsReading(JSON.parse(raw), Date.now());
    if (r) {
      const dir = path.join(home, '.vigie', 'limits');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, r.name);
      fs.writeFileSync(file + '.tmp', JSON.stringify(r.data));
      fs.renameSync(file + '.tmp', file);
    }
  } catch { /* la statusline ne doit jamais casser */ }
});
