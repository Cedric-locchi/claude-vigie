import { Injectable, computed, effect, inject, resource } from '@angular/core';
import { PluginHost, errorMessage, launcher, natureThemes, type LauncherTask, type TaskTheme } from '@vigie/plugin-sdk';
import { NxGraph as NxGraphSchema, NxInfo as NxInfoSchema } from '../contract.mjs';
import type { NxGraph } from './models';

/** Dernier graphe lu par session : réaffiché dès l'entrée dans l'onglet, pendant la relecture (jusqu'à 60 s).
 *  ponytail: mémoire du module, perdue au rechargement de la page. */
const lastGraph = new Map<string, NxGraph>();

export const NX_MISSING = 'nx introuvable : installe les dépendances du dépôt ou nx sur le PATH.';

export const NOT_RUNNABLE = 'Nom non lançable depuis Vigie';

/** Cibles → thèmes par nature (mêmes thèmes que npm, sur le nom de la cible). La tâche affiche `projet:cible` ; le type
 *  (app, lib, e2e) précède la description ; type et dossier comptent pour la recherche. */
export function nxThemes(projects: NxGraph['projects']): TaskTheme[] {
  return natureThemes(projects.flatMap((p) => {
    const siblings = new Set(p.targets.map((t) => t.name));
    return p.targets.map((t) => ({
      name: t.name, siblings,
      task: {
        id: `${p.name}:${t.name}`, name: `${p.name}:${t.name}`, command: t.command,
        hint: t.description ? (p.type ? `${p.type} · ${t.description}` : t.description) : null,
        disabledReason: t.runnable ? null : NOT_RUNNABLE, keywords: [p.type, p.root],
      } satisfies LauncherTask,
    }));
  }));
}

/**
 * Onglet « Nx » : `info` d'abord (rapide : nx du dépôt ou du PATH, télémétrie), puis `graph` (lent : `nx graph`), jamais
 * avec la télémétrie active. On lance `nx run projet:cible` dans un nouveau terminal, que la page affiche.
 */
@Injectable()
export class NxVm {
  private readonly host = inject(PluginHost);
  private readonly id = computed(() => this.host.sessionId());

  private readonly infoRes = resource({
    params: () => ({ id: this.id(), cwd: this.host.cwd() }),
    loader: ({ abortSignal }) => this.host.call('info', {}, NxInfoSchema, { signal: abortSignal }),
  });
  readonly info = computed(() => (this.infoRes.hasValue() ? this.infoRes.value() : null));
  /** Le graphe attend `info` et n'est pas demandé si la télémétrie est active (nx enverrait une requête). Une relecture
   *  d'`info` (Rafraîchir) donne un nouvel objet, donc relit le graphe. */
  private readonly graphRes = resource({
    params: () => { const i = this.info(); return i && !i.telemetry ? { id: this.id(), info: i } : undefined; },
    loader: ({ abortSignal }) => this.host.call('graph', {}, NxGraphSchema, { signal: abortSignal }),
  });
  private readonly remember = effect(() => {
    if (this.graphRes.hasValue()) lastGraph.set(this.id(), this.graphRes.value());
  });
  readonly telemetry = computed(() => !!this.info()?.telemetry);
  /** Rien avec la télémétrie active : un graphe gardé d'avant ne compte plus (la note dit de rafraîchir). */
  readonly graph = computed<NxGraph | null>(() =>
    this.telemetry() ? null : this.graphRes.hasValue() ? this.graphRes.value() : lastGraph.get(this.id()) ?? null);
  readonly loadingInfo = computed(() => this.infoRes.isLoading());
  readonly loadingGraph = computed(() => this.graphRes.isLoading());
  readonly loading = computed(() => this.loadingInfo() || this.loadingGraph());
  readonly source = computed(() => { const i = this.info(); return i ? (i.local ? 'nx du dépôt (node_modules/.bin/nx)' : 'nx du PATH') : null; });
  /** Cible en cours de lancement (`projet:cible`) : un lancement à la fois. */
  private readonly launches = launcher();
  readonly launching = this.launches.launching;
  readonly launchError = this.launches.error;
  /**
   * Message sous le lanceur : échec du dernier lancement ; sinon échec de lecture (pas un espace Nx, daemon d'une autre
   * version), nx introuvable, ou le message de `graph` (aucun avec la télémétrie active : pas de graphe, la note l'explique).
   */
  readonly error = computed(() => {
    const launch = this.launchError();
    if (launch) return launch;
    for (const r of [this.infoRes, this.graphRes]) if (r.status() === 'error') return errorMessage(r.error(), 'Lecture de l’espace Nx impossible.');
    const g = this.graph();
    if (g && !g.available) return NX_MISSING;
    return g?.error ?? null;
  });
  readonly projects = computed(() => this.graph()?.projects ?? []);
  readonly themes = computed(() => nxThemes(this.projects()));
  readonly storageKey = computed(() => `nx:${this.host.cwd()}`);

  refresh(): void {
    this.infoRes.reload();
  }

  /** `task.id` = `projet:cible` ; un projet lançable n'a jamais de `:` (ID du contrat). */
  run(task: Pick<LauncherTask, 'id'>): Promise<void> {
    const i = task.id.indexOf(':');
    const project = task.id.slice(0, i);
    const target = task.id.slice(i + 1);
    return this.launches.run(task.id, () => this.host.terminal('run', { project, target }), 'Impossible de lancer la cible.');
  }
}
