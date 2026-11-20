import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ago } from '../../../core/format';
import { renderMarkdown } from '../../../core/markdown';
import { keepLast } from '../../../core/signals';
import { VigieService, daemonError } from '../../../core/vigie.service';

interface Source { id: Signal<string>; planTs: Signal<number | null> }

/** Onglet Plan : dernier plan proposé par Claude (ExitPlanMode), relu quand `planTs` change. */
@Injectable()
export class SessionPlanVm {
  private readonly vigie = inject(VigieService);
  private readonly source = signal<Source | null>(null);
  private readonly id = computed(() => this.source()?.id() ?? null);
  private readonly ts = computed(() => this.source()?.planTs() ?? null);
  private readonly res = this.vigie.planResource(this.id, this.ts);

  /** Garde le plan affiché pendant le rechargement d'un plan plus récent : pas de clignotement. */
  readonly plan = keepLast(this.res, this.id);
  readonly html = computed(() => {
    const p = this.plan();
    return p ? renderMarkdown(p.text, { breaks: true }) : null;
  });
  readonly error = computed(() => (this.res.status() === 'error' ? daemonError(this.res.error(), 'Plan indisponible.') : null));
  readonly loading = this.res.isLoading;
  /** « il y a 12 min », d'après l'horloge du daemon (locale tant qu'aucun snapshot n'est arrivé). */
  readonly age = computed(() => {
    const p = this.plan();
    return p ? ago((this.vigie.snapshot()?.now ?? Date.now()) - p.ts) : null;
  });

  connect(id: Signal<string>, planTs: Signal<number | null>): void {
    this.source.set({ id, planTs });
  }

  /** « Réessayer » après une erreur. */
  reload(): void {
    this.res.reload();
  }
}
