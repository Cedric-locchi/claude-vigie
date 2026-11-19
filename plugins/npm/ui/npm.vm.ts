import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { PluginHost, natureThemes, type LauncherTask, type TaskTheme } from '@vigie/plugin-sdk';
import { NpmProject as NpmProjectSchema } from '../contract.mjs';
import type { NpmProject } from './models';

/** Scripts → thèmes par nature (Développement, Build, Tests…), racine d'abord puis les workspaces dans l'ordre du daemon.
 *  Une tâche de workspace porte son nom en `scope` (affiché, cherché, dit dans le libellé accessible). */
export function npmThemes(p: NpmProject | null): TaskTheme[] {
  if (!p) return [];
  const packages = [{ workspace: null as string | null, dir: null as string | null, scripts: p.scripts }, ...p.workspaces.map((w) => ({ workspace: w.name, dir: w.dir, scripts: w.scripts }))];
  return natureThemes(packages.flatMap(({ workspace, dir, scripts }) => {
    const siblings = new Set(scripts.map((s) => s.name));
    return scripts.map((s) => ({
      name: s.name, siblings,
      task: { id: `${workspace ?? ''}\n${s.name}`, name: s.name, scope: workspace, command: s.command, keywords: dir ? [dir] : [] } satisfies LauncherTask,
    }));
  }));
}

/**
 * Onglet « Scripts npm » : lit le projet par le backend du plugin (à l'entrée dans l'onglet et sur « Rafraîchir ») ;
 * lance un script de la racine ou d'un workspace dans un nouveau terminal, avec le gestionnaire du dépôt.
 */
@Injectable()
export class NpmVm {
  private readonly host = inject(PluginHost);

  private readonly res = resource({
    params: () => ({ id: this.host.sessionId(), cwd: this.host.cwd() }),
    loader: ({ abortSignal }) => this.host.call('project', {}, NpmProjectSchema, { signal: abortSignal }),
  });
  readonly project = computed(() => (this.res.hasValue() ? this.res.value() : null));
  readonly loading = computed(() => this.res.isLoading());
  /** « pnpm · pnpm-lock.yaml » : le gestionnaire retenu et d'où vient ce choix. */
  readonly manager = computed(() => { const p = this.project(); return p && !p.error ? `${p.pm} · ${p.from}` : null; });
  readonly themes = computed(() => npmThemes(this.project()));
  readonly storageKey = computed(() => `npm:${this.host.cwd()}`);
  /** Script en cours de lancement (id de la tâche) : un lancement à la fois. */
  readonly launching = signal<string | null>(null);
  readonly launchError = signal<string | null>(null);
  /** Échec de lancement, package.json absent ou illisible, sinon l'échec de lecture (daemon, réponse hors contrat). */
  readonly error = computed(() => this.launchError() ?? this.project()?.error ?? (this.res.status() === 'error' ? this.res.error()?.message || 'Lecture du package.json impossible.' : null));

  refresh(): void {
    this.res.reload();
  }

  async run(task: LauncherTask): Promise<void> {
    if (this.launching() !== null) return;
    this.launching.set(task.id);
    this.launchError.set(null);
    try {
      await this.host.terminal('run', { script: task.name, workspace: task.scope ?? null });
    } catch (e) {
      this.launchError.set((e as Error)?.message || 'Impossible de lancer le script.');
    } finally {
      this.launching.set(null);
    }
  }
}
