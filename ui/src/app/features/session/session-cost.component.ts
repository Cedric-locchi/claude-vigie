import { Component, inject, input } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import * as f from '../../core/format';
import { Agent, SessionState } from '../../core/models';
import { PlotChartComponent } from '../usage/plot-chart.component';
import { SessionCostVm } from './session-cost.vm';

/** Carte « Coût de la session au fil du temps, par agent » de l'onglet Consommation. */
@Component({
  selector: 'app-session-cost',
  imports: [HlmButton, HlmCardImports, PlotChartComponent],
  providers: [SessionCostVm],
  template: `
    <section hlmCard class="card" aria-labelledby="cost-title">
      <h3 hlmCardTitle id="cost-title">Coût au fil du temps, par agent</h3>
      @if (vm.error(); as err) {
        <div class="state small" role="alert">
          <span class="err">{{ err }}</span>
          <button hlmBtn variant="outline" size="sm" [disabled]="vm.loading()" (click)="vm.reload()">Réessayer</button>
        </div>
      } @else if (!vm.series()) {
        <p class="small muted">Chargement…</p>
      } @else if (vm.empty()) {
        <p class="small muted">Pas encore de coût pour cette session.</p>
      } @else {
        <app-plot-chart [draw]="vm.draw()" [label]="vm.label()" />
        <div class="legend small">
          @for (s of vm.series()!.series; track s.id) {
            <span><i [style.background]="s.color"></i>{{ s.name }} <span class="mono muted">{{ f.usd(s.total) }}</span></span>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .card { padding: 16px 18px; gap: 14px; }
    .state { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .err { color: var(--err); }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; }
    .legend > span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .legend i { flex: none; width: 10px; height: 10px; border-radius: 2px; }
  `,
})
export class SessionCostComponent {
  readonly sessionId = input.required<string>();
  readonly state = input.required<SessionState>();
  readonly lastTs = input.required<number>();
  readonly agents = input.required<Agent[]>();
  protected readonly vm = inject(SessionCostVm);
  protected readonly f = f;

  constructor() {
    this.vm.connect({ id: this.sessionId, state: this.state, lastTs: this.lastTs, agents: this.agents });
  }
}
