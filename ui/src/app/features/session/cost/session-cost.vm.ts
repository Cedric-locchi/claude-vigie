import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import * as f from '../../../core/format';
import { Agent, SessionCost, SessionState } from '../../../core/models';
import { VigieService } from '../../../core/vigie.service';
import { costChart, cumulByAgent } from './session-cost';

/** Au plus un rechargement par période d'activité : le détail, lui, bouge toutes les 400 ms. */
export const COST_REFRESH_MS = 30_000;

interface Source { id: Signal<string>; state: Signal<SessionState>; lastTs: Signal<number>; agents: Signal<Agent[]> }

@Injectable()
export class SessionCostVm {
  private readonly vigie = inject(VigieService);
  private readonly source = signal<Source | null>(null);

  readonly cost = signal<SessionCost | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private loadedFor: string | null = null;
  private lastState: SessionState | null = null;
  private lastLoad = 0;

  constructor() {
    // Ouverture, changement de session ou d'état : tout de suite. Simple activité : au plus toutes les 30 s.
    effect(() => {
      const src = this.source();
      if (!src) return;
      const [id, state] = [src.id(), src.state()];
      src.lastTs();
      untracked(() => {
        const due = id !== this.loadedFor || state !== this.lastState || Date.now() - this.lastLoad >= COST_REFRESH_MS;
        this.lastState = state;
        if (due) void this.load(id);
      });
    });
  }

  connect(source: Source): void {
    this.source.set(source);
  }

  /** « Réessayer » après une erreur. */
  reload(): void {
    const id = this.source()?.id();
    if (id) void this.load(id);
  }

  private async load(id: string): Promise<void> {
    if (this.loadedFor !== id) this.cost.set(null);
    this.loadedFor = id;
    this.lastLoad = Date.now();
    this.loading.set(true);
    try {
      const cost = await this.vigie.sessionCost(id);
      if (this.loadedFor !== id) return; // réponse d'une session quittée entre-temps
      this.cost.set(cost);
      this.error.set(null);
    } catch {
      if (this.loadedFor === id) this.error.set('Coût indisponible : le daemon est-il à jour ? (redémarre-le après une mise à jour)');
    } finally {
      this.loading.set(false);
    }
  }

  private readonly names = computed(() => this.source()?.agents().map(({ id, name, sub }) => ({ id, name, sub })) ?? [], {
    equal: (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name && x.sub === b[i].sub),
  });
  readonly series = computed(() => {
    const c = this.cost();
    return c ? cumulByAgent(c, this.names()) : null;
  });
  readonly empty = computed(() => !!this.series() && !this.series()!.totals.at(-1)?.total);
  readonly draw = computed(() => costChart(this.series()!));
  /** Alternative textuelle du graphique (lecteurs d'écran). */
  readonly label = computed(() => {
    const s = this.series();
    if (!s) return '';
    return `Coût cumulé de la session par agent : ${s.series.filter((x) => x.total > 0).map((x) => `${x.name} ${f.usd(x.total)}`).join(', ')}.`;
  });
}
