import { Injectable, computed, inject, resource } from '@angular/core';
import { PluginHost, errorMessage, launcher, type LauncherTask, type TaskTheme } from '@vigie/plugin-sdk';
import { MiseTasks as MiseTasksSchema } from '../contract.mjs';
import type { MiseTasks } from './models';

/** Seules les tâches du projet comptent : les globales (~/.config/mise) suivent l'utilisateur partout. */
export const projectTasks = (m: MiseTasks | null | undefined) => (m?.tasks ?? []).filter((t) => !t.global);

/** Secteur d'une tâche et son nom court : préfixe avant « : » (`front:build` → front / build) ;
 *  sinon le dossier de son mise.toml (`ui/mise.toml` → ui) ; sinon le projet lui-même. */
export function sectorOf(t: { name: string; source: string }): { sector: string; short: string } {
  const i = t.name.indexOf(':');
  if (i > 0 && i < t.name.length - 1) return { sector: t.name.slice(0, i), short: t.name.slice(i + 1) };
  const parts = t.source.split(/[\\/]/);
  // Une tâche-fichier (.mise/tasks/…, mise-tasks/…) a déjà son sous-dossier dans le nom : seul un mise*.toml désigne un secteur.
  if (!/mise[^\\/]*\.toml$/.test(parts.at(-1) ?? '')) return { sector: PROJECT, short: t.name };
  const dir = parts.slice(0, -1).filter((s) => s && s !== '.' && s !== '~' && !s.startsWith('.'));
  return { sector: dir.at(-1) ?? PROJECT, short: t.name };
}
const PROJECT = 'Projet';
/** Id de lancement de `mise trust` (aucune tâche ne porte un nom vide). */
const TRUST = '';

export const MISE_MISSING = 'mise n’est pas installé (ou pas sur le PATH) : installe-le pour voir et lancer les tâches de ce projet.';

/** Secteurs → thèmes du lanceur : « Projet » d'abord, puis l'ordre alphabétique ; tâches triées par nom court.
 *  La commande est ce que la tâche exécute (`run`, sinon son fichier) ; alias et dépendances comptent pour la recherche. */
export function miseThemes(tasks: MiseTasks['tasks']): TaskTheme[] {
  const groups = new Map<string, LauncherTask[]>();
  for (const t of tasks) {
    const { sector, short } = sectorOf(t);
    const task: LauncherTask = { id: t.name, name: short, hint: t.description || null, command: t.run.join(' && ') || t.file, keywords: [t.name, ...t.aliases, ...t.depends] };
    groups.set(sector, [...(groups.get(sector) ?? []), task]);
  }
  return [...groups]
    .sort(([a], [b]) => (a === PROJECT ? -1 : b === PROJECT ? 1 : a.localeCompare(b)))
    .map(([label, ts]) => ({ id: label, label, tasks: ts.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * Onglet « Tâches mise » : lit les tâches par le backend du plugin (à l'entrée dans l'onglet et sur « Rafraîchir ») ;
 * lance une tâche ou `mise trust` dans un nouveau terminal, que la page affiche.
 */
@Injectable()
export class MiseVm {
  private readonly host = inject(PluginHost);

  private readonly res = resource({
    params: () => ({ id: this.host.sessionId(), cwd: this.host.cwd() }),
    loader: ({ abortSignal }) => this.host.call('tasks', {}, MiseTasksSchema, { signal: abortSignal }),
  });
  private readonly mise = computed(() => (this.res.hasValue() ? this.res.value() : null));
  readonly loading = computed(() => this.res.isLoading());
  readonly tasks = computed(() => projectTasks(this.mise()));
  readonly themes = computed(() => miseThemes(this.tasks()));
  readonly storageKey = computed(() => `mise:${this.host.cwd()}`);
  readonly untrusted = computed(() => !!this.mise()?.untrusted);
  /** mise absent : l'onglet apparaît dès que le projet déclare des tâches. */
  readonly missing = computed(() => this.mise()?.available === false);
  /** Message de mise (config non approuvée, toml invalide…), sortie brute affichée telle quelle. */
  readonly notice = computed(() => (this.missing() ? null : this.mise()?.error ?? null));
  /** Échec de lecture (daemon, réponse hors contrat) ou de lancement. */
  readonly error = computed(() => this.launchError() ?? (this.res.status() === 'error' ? errorMessage(this.res.error(), 'Lecture des tâches mise impossible.') : null));
  /** Tâche en cours de lancement (ou `trust`) : un lancement à la fois. */
  private readonly launches = launcher();
  readonly launching = this.launches.launching;
  readonly launchError = this.launches.error;

  refresh(): void {
    this.res.reload();
  }

  run(task: Pick<LauncherTask, 'id'>): Promise<void> {
    return this.launches.run(task.id, () => this.host.terminal('run', { task: task.id }), 'Impossible de lancer la tâche.');
  }

  /** `mise trust` dans un terminal : l'utilisateur voit ce qu'il approuve ; la liste se relit au retour sur l'onglet,
   *  et les onglets de la session sont relus (détection). */
  trust(): Promise<void> {
    return this.launches.run(TRUST, async () => { await this.host.terminal('trust'); this.host.refresh(); }, 'Impossible de lancer mise trust.');
  }
}
