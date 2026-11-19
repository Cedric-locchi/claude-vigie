/**
 * SDK front des plugins (décision 037). `host.ts` : le pont (PluginHost, OUTDATED), seul fichier que le cœur de l'UI importe,
 * pour que le lanceur ne tombe pas dans le chargement initial ; le lanceur n'est chargé qu'avec le chunk d'un plugin.
 */
export * from './host';

// Lanceur de tâches partagé (mise, npm, nx) : thèmes repliables, recherche, bouton « Lancer » par tâche.
export { TaskLauncherComponent } from './task-launcher.component';
export { NATURES, natureOf, natureThemes, launchLabel, type LauncherTask, type Nature, type TaskTheme } from './task-launcher.vm';
