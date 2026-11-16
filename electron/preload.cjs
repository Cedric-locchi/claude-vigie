// Pont minimal UI ↔ app de bureau : seul le sélecteur de dossier natif est exposé. CommonJS : le preload d'une fenêtre sandboxée n'accepte pas l'ESM.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vigieDesktop', {
  /** Ouvre le sélecteur natif ; résout le dossier choisi (chemin absolu) ou null si annulé. */
  pickFolder: (from) => ipcRenderer.invoke('vigie:pick-folder', typeof from === 'string' ? from : ''),
});
