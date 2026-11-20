// Réglages du daemon (~/.vigie/settings.json) : lecture tolérante, écriture atomique, locales installées (`locale -a`).
// Le schéma arrive en argument : le contrat n'est importé que par transport.mjs.
import { execFile } from 'node:child_process';
import fs from 'node:fs';

/**
 * `plugins` hors contrat (édité à la main) : seules ses entrées booléennes sont gardées, sans faire rejeter la locale ni
 * les alertes. Pur ; le reste de l'objet est inchangé.
 */
export function keepBooleanPlugins(raw) {
  if (!raw || typeof raw !== 'object' || !('plugins' in raw)) return raw;
  const p = raw.plugins;
  return { ...raw, plugins: Object.fromEntries(p && typeof p === 'object' && !Array.isArray(p) ? Object.entries(p).filter(([, v]) => typeof v === 'boolean') : []) };
}

/**
 * Réglages lus avec `schema` (SettingsFile : SettingsBody + `plugins` ; avec SettingsBody, zod retirerait `plugins` et le
 * prochain POST /api/settings l'effacerait du fichier). Absent, illisible ou hors contrat : `{ locale: null }` plutôt
 * qu'une locale invalide dans les PTY.
 */
export function readSettings(file, schema) {
  try {
    const r = schema.safeParse(keepBooleanPlugins(JSON.parse(fs.readFileSync(file, 'utf8'))));
    if (r.success) return r.data;
  } catch { /* pas encore de réglages */ }
  return { locale: null };
}

/** tmp + rename : jamais de fichier tronqué. `file` null : rien n'est écrit (réglages en mémoire). Lève en cas d'échec. */
export function writeSettings(file, settings) {
  if (!file) return;
  fs.writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2));
  fs.renameSync(file + '.tmp', file);
}

/** Sortie de `locale -a` (sans shell, délai court) ; null si la commande manque ou échoue (on ne bloque pas l'enregistrement). */
export const listLocales = () => new Promise((resolve) => execFile('locale', ['-a'], { timeout: 3000, maxBuffer: 4e6 }, (err, out) => resolve(err ? null : out)));
