#!/usr/bin/env node
// Hook Claude Code des sessions lancées par Vigie (décision 021 : chemin par défaut, un process par événement) : ajoute
// l'événement reçu sur stdin au spool de Vigie, puis sort sans rien dire (sortie vide + code 0 = Claude continue normalement).
// La route POST /api/hook (hooks HTTP, même spool) reste dans le transport mais n'est plus branchée (cf. launch.hooksSettings).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spoolLine } from './launch.mjs';

const dir = path.join(os.homedir(), '.vigie');
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const line = spoolLine(JSON.parse(raw));
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'spool.jsonl'), JSON.stringify(line) + '\n');
  } catch { /* un hook ne doit jamais bloquer Claude */ }
});
