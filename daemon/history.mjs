// Fichier d'historique de consommation (~/.vigie/usage.json, décision 025) : lecture prudente et écriture atomique.
// Le contenu (lignes, fenêtres) est calculé par usage.mjs ; ce module ne fait que le disque.
import fs from 'node:fs';
import path from 'node:path';
import { validHistory } from './usage.mjs';

/**
 * Lit l'historique une fois. `seed` : pas d'historique utilisable, le premier scan remonte plus loin pour l'amorcer ;
 * `canWrite` faux : on n'écrira jamais (fichier illisible qu'on n'a pas pu mettre de côté). Un fichier corrompu est
 * renommé en `<fichier>.corrupt-<ts>`, jamais écrasé. `file` null : pas de persistance.
 */
export function openHistory(file) {
  const empty = { rows: [], windows: [] };
  if (!file) return { history: empty, seed: false, canWrite: false };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { history: empty, seed: true, canWrite: true };
    console.error(`[vigie] historique illisible (${e.code}), non enregistré : ${file}`);
    return { history: empty, seed: false, canWrite: false };
  }
  let h = null;
  try { h = validHistory(JSON.parse(raw)); } catch { /* JSON tronqué */ }
  if (h) return { history: h, seed: false, canWrite: true };
  const aside = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, aside);
    console.error(`[vigie] historique illisible, mis de côté : ${aside}`);
    return { history: empty, seed: true, canWrite: true };
  } catch (e) {
    console.error(`[vigie] historique illisible et impossible à mettre de côté, non enregistré : ${e.message}`);
    return { history: empty, seed: true, canWrite: false };
  }
}

/** Écrit l'historique (tmp + rename : jamais de fichier tronqué). Lève en cas d'échec. */
export function writeHistory(file, history) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, ...history }));
  fs.renameSync(file + '.tmp', file);
}
