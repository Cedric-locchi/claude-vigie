#!/usr/bin/env node
// Statusline relais (sessions lancées par Vigie) : Claude Code y passe les vraies limites de quota
// (rate_limits), qu'on garde pour la carte de monitoring, puis on rend la main à la statusline
// habituelle de l'utilisateur avec la même entrée.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const home = os.homedir();
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    const cmd = settings.statusLine?.command;
    if (cmd) process.stdout.write(execSync(cmd.replace(/^~(?=\/)/, home), { input: raw, shell: 'bash', timeout: 4000 }));
  } catch { /* pas de statusline utilisateur, ou elle a échoué */ }
  // Après la statusline de l'utilisateur : la sienne peut écrire le même fichier, sans context_window.
  try {
    const e = JSON.parse(raw);
    // Quota (rate_limits) et taille max du contexte (context_window) de la session.
    if (e.rate_limits || e.context_window) {
      const dir = path.join(home, '.vigie', 'limits');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${String(e.session_id ?? 'inconnue').replace(/[^\w-]/g, '')}.json`);
      fs.writeFileSync(file + '.tmp', JSON.stringify({ ts: Date.now(), rate_limits: e.rate_limits, context_window: e.context_window }));
      fs.renameSync(file + '.tmp', file);
    }
  } catch { /* la statusline ne doit jamais casser */ }
});
