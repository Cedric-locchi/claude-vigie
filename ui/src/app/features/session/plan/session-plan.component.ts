import { Component, inject, input } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import * as f from '../../../core/format';
import { SessionPlanVm } from './session-plan.vm';

/** Onglet Plan de la page de session : le dernier plan proposé, en Markdown rendu. */
@Component({
  selector: 'app-session-plan',
  imports: [HlmButton],
  providers: [SessionPlanVm],
  template: `
    @if (vm.error(); as err) {
      <div class="state small" role="alert">
        <span class="err">{{ err }}</span>
        <button hlmBtn variant="outline" size="sm" [disabled]="vm.loading()" (click)="vm.reload()">Réessayer</button>
      </div>
    } @else if (vm.plan(); as p) {
      <p class="small faint">Proposé {{ vm.age() }} · <time>{{ f.clock(p.ts) }}</time></p>
      <!-- [innerHTML] passe par le sanitizer d'Angular ; HTML issu de renderMarkdown seul (décision 044). -->
      <article class="panel markdown" [innerHTML]="vm.html()"></article>
    } @else {
      <p class="small muted">Chargement du plan…</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; max-width: 80ch; }
    .state { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .err { color: var(--err); }
    article { padding: 18px 22px; }
  `,
})
export class SessionPlanComponent {
  readonly sessionId = input.required<string>();
  readonly planTs = input.required<number | null>();
  protected readonly vm = inject(SessionPlanVm);
  protected readonly f = f;

  constructor() {
    this.vm.connect(this.sessionId, this.planTs);
  }
}
