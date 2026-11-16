import { Component, computed, input, output } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import * as f from '../../../../core/format';
import { Agent } from '../../../../core/models';
import { agentLabel } from '../../../../core/session-view';


/** Ligne d'un agent dans le panneau : état, ce qu'il fait ; un clic ouvre le détail. Les réponses passent par la barre d'attente. */
@Component({
  selector: 'app-agent-row',
  imports: [HlmBadge],
  template: `
    @let a = agent();
    <button type="button" class="row" [attr.data-state]="a.issue ? 'issue' : a.state" [class.wait-arrive]="a.state === 'waiting'" (click)="open.emit()">
      <span class="top">
        <span class="name">{{ a.name }}@if (a.sub) { <span class="faint small sub-tag">sous-agent</span> }</span>
        <span hlmBadge [variant]="a.issue ? 'issue' : a.state">{{ label() }}</span>
      </span>
      @if (a.state === 'waiting') {
        <span class="line">{{ a.reason === 'question' ? (a.detail || 'Pose une question') : 'Veut lancer' }}@if (a.reason !== 'question') { <span class="mono">{{ a.detail ?? a.lastAction }}</span> }</span>
      } @else if (a.issue) {
        <span class="line issue">{{ a.issue }}</span>
      } @else if (a.lastAction && a.state !== 'done') {
        <span class="line mono">{{ a.lastAction }}</span>
      } @else if (a.lastText) {
        <span class="line muted">{{ a.lastText }}</span>
      }
      <span class="sr-only">Voir le détail</span>
      <span class="stats mono">
        <span>{{ a.toolCount }} outils</span><span>{{ f.tokens(a.tokens) }} tok</span><span>{{ f.duration(a.lastTs - a.firstTs) }}</span>
      </span>
    </button>
  `,
  styles: `
    :host { display: block; }
    :host + :host .row { border-top: 1px solid var(--line); }
    .row {
      display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 10px 14px; border: 0; background: transparent;
      color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease);
    }
    .row:hover { background: var(--hover); }
    .row:active { background: var(--press); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    /* Barre d'état à gauche (DESIGN.md « State bar », 3px dans les listes). Rien pour « à toi » et « terminé ». */
    .row[data-state='waiting'] { box-shadow: inset 3px 0 0 var(--wait); }
    .row[data-state='issue'] { box-shadow: inset 3px 0 0 var(--err); }
    .row[data-state='running'] { box-shadow: inset 3px 0 0 var(--brand); }
    .row[data-state='done'] .name { color: var(--text-muted); }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    /* Marge plutôt qu'espace : le compilateur retire les blancs en tête d'un bloc @if. */
    .sub-tag { margin-inline-start: 6px; font-weight: 400; }
    .name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .line { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .line.mono, .line .mono { font-size: 12px; }
    .issue { color: var(--err); }
    .stats { display: flex; gap: 12px; font-size: 11px; color: var(--faint); }
  `,
})
export class AgentRowComponent {
  readonly agent = input.required<Agent>();
  readonly open = output();

  protected readonly f = f;
  protected readonly label = computed(() => agentLabel(this.agent()));
}
