// Garde-fous HTTP du daemon (hôte, chemin statique), en fonctions pures utilisées par transport.mjs.
import path from 'node:path';

/**
 * Hôte de la requête : seulement 127.0.0.1 ou localhost sur notre port. Bloque le DNS rebinding
 * (une page sur evil.com qui résout vers 127.0.0.1 envoie `Host: evil.com:<port>` et passe le contrôle d'origine sur les GET).
 * Un futur proxy de dev devra réécrire le Host (`changeOrigin: true`).
 * ponytail: port 80 (Host sans port) non géré ; ajouter `127.0.0.1` / `localhost` nus si le daemon y écoute un jour.
 */
export function hostOk(host, port) {
  const h = String(host ?? '').toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/**
 * Fichier statique candidat sous `uiDir` pour un chemin d'URL (le stat et le repli sur index.html restent au serveur).
 * null si le chemin est indécodable (`/%C0`) : réponse 400. Un chemin qui sortirait du dossier renvoie `uiDir`, qui n'est
 * pas un fichier : repli sur index.html.
 */
export function staticFile(uiDir, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  // Un octet nul fait lever fs.statSync même avec throwIfNoEntry: false.
  if (p.includes('\0')) return null;
  const file = path.join(uiDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  return file === uiDir || file.startsWith(uiDir + path.sep) ? file : uiDir;
}
