import { Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';

export interface WaitBar {
  question: boolean;
  canAllow: boolean;
  detail: string | null;
}

/** Barre d'attente sous l'en-tête de la session, sur tous les onglets : la demande de Claude et la réponse, sans changer de vue. */
@Component({
  selector: 'app-wait-bar',
  imports: [HlmButton, HlmTooltip],
  host: { class: 'wait-arrive', role: 'status' },
  template: `
    @let w = bar();
    <p>
      @if (w.question) { {{ w.detail || 'Claude te pose une question.' }} }
      @else if (w.detail) { Claude veut lancer <span class="mono">{{ w.detail }}</span> }
      @else { Claude attend ton autorisation. }
    </p>
    <div class="actions">
      @if (w.canAllow) {
        <button hlmBtn variant="wait" size="sm" [hlmTooltip]="TYPED" (click)="allow.emit()">Autoriser</button>
        <button hlmBtn variant="outline" size="sm" [hlmTooltip]="TYPED" (click)="refuse.emit()">Refuser</button>
      }
      <button hlmBtn variant="outline" size="sm" (click)="focusTerminal.emit()">Aller au terminal</button>
    </div>
    @if (error(); as err) { <p class="err" role="alert">{{ err }}</p> }
  `,
  styles: `
    :host { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 14px; border: 1px solid var(--wait-line); border-radius: 10px; background: var(--wait-bg); box-shadow: inset 3px 0 0 var(--wait); color: var(--text); font-size: 13px; }
    p { flex: 1 1 240px; min-width: 0; overflow-wrap: anywhere; }
    .mono { color: var(--wait); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .err { flex-basis: 100%; color: var(--err); font-size: 12px; }
  `,
})
export class WaitBarComponent {
  readonly bar = input.required<WaitBar>();
  /** Échec de la dernière réponse (Autoriser / Refuser) : affiché sous les boutons. */
  readonly error = input<string | null>(null);
  readonly allow = output();
  readonly refuse = output();
  readonly focusTerminal = output();

  protected readonly TYPED = 'Le choix est tapé dans le terminal, comme au clavier';
}
