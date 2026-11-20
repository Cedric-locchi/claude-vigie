/* global matchMedia, document */
// Thème posé avant Angular pour éviter un flash sombre/clair (même logique que ThemeService). Fichier à part, chargé de façon
// synchrone en tête de page : la CSP du daemon (décision 044) interdit tout script en ligne.
try {
  var t = localStorage.getItem('vigie-theme');
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
} catch {
  // stockage bloqué : le thème sombre par défaut reste
}
