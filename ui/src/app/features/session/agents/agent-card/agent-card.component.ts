import { Component, computed, input, output } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import * as f from '../../../../core/format';
import { Agent } from '../../../../core/models';
import { agentLabel } from '../../../../core/session-view';


/** Carte d'un agent dans le panneau de détail : état, ce qu'il fait, sa question ou son souci, réponses rapides. */
@Component({
  selector: 'app-agent-card',
  imports: [HlmBadge, HlmButton, HlmCard, HlmTooltip],
  template: `
    @let a = agent();
    <article hlmCard class="agent" [class.is-wait]="a.state === 'waiting'" [class.wait-arrive]="a.state === 'waiting'" [class.is-err]="!!a.issue" [class.dim]="a.state === 'done' && !a.issue">
      <div class="top">
        <span class="name">{{ a.name }}@if (a.sub) { <span class="faint small sub-tag">sous-agent</span> }</span>
        <span hlmBadge [variant]="chip()">{{ label() }}</span>
      </div>
      @if (a.description && a.sub) { <span class="small muted">{{ a.description }}</span> }

      @if (a.state === 'waiting') {
        <p>{{ a.reason === 'question' ? (a.detail || 'Pose une question') : 'Veut lancer' }}
          @if (a.reason !== 'question') { <span class="mono small">{{ a.detail ?? a.lastAction }}</span> }
        </p>
        @if (canAnswer()) {
          <div class="actions">
            @if (a.reason === 'permission') {
              <button hlmBtn variant="wait" size="sm" [hlmTooltip]="TYPED" (click)="allow.emit()">Autoriser</button>
              <button hlmBtn variant="outline" size="sm" [hlmTooltip]="TYPED" (click)="refuse.emit()">Refuser</button>
            }
            <button hlmBtn variant="outline" size="sm" (click)="focusTerminal.emit()">Aller au terminal</button>
          </div>
          @if (error(); as err) { <p class="issue" role="alert">{{ err }}</p> }
        }
      } @else if (a.issue) {
        <p class="issue">{{ a.issue }}</p>
      } @else if (a.lastAction && a.state !== 'done') {
        <span class="mono small action" [hlmTooltip]="a.lastAction" [showDelay]="400">{{ a.lastAction }}</span>
      } @else if (a.lastText) {
        <p class="small muted clamp">{{ a.lastText }}</p>
      }
      <div class="small faint mono stats">
        <span>{{ a.toolCount }} outils</span><span>{{ f.tokens(a.tokens) }} tok</span><span>{{ f.duration(a.lastTs - a.firstTs) }}</span>
      </div>
    </article>
  `,
  styles: `
    .agent { padding: 14px 16px; gap: 10px; transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
    /* Carte à plat : l'état recolore la bordure (filet), jamais une ombre. */
    .agent.is-wait { border-color: var(--wait-line); background: color-mix(in oklch, var(--card), var(--wait-bg) 60%); }
    .agent.is-err { border-color: var(--err-line); }
    .agent.dim { background: var(--dim-bg); }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    /* Marge plutôt qu'espace : le compilateur retire les blancs en tête d'un bloc @if. */
    .sub-tag { margin-inline-start: 6px; font-weight: 400; }
    .name { font-weight: 600; }
    p { line-height: 1.5; overflow-wrap: anywhere; }
    .issue { color: var(--err); font-size: 13px; }
    .action { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .stats { display: flex; gap: 12px; }
  `,
})
export class AgentCardComponent {
  readonly agent = input.required<Agent>();
  readonly canAnswer = input(false);
  /** Échec de la dernière réponse rapide (Autoriser / Refuser). */
  readonly error = input<string | null>(null);
  readonly allow = output();
  readonly refuse = output();
  readonly focusTerminal = output();

  protected readonly f = f;
  /** Infobulle des réponses rapides. */
  protected readonly TYPED = 'Le choix est tapé dans le terminal, comme au clavier';
  protected readonly chip = computed(() => (this.agent().issue ? 'issue' : this.agent().state));
  protected readonly label = computed(() => agentLabel(this.agent()));
}
