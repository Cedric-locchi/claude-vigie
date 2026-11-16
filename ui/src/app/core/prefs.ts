// Préférences de ce navigateur (localStorage). Stockage bloqué ou absent : lecture null, écriture ignorée,
// le choix vaut alors jusqu'au rechargement.

export function readPref(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

export function writePref(key: string, value: string): void {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* stockage bloqué */ }
}
