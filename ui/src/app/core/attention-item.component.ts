import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { UsageAlert } from './attention';
import { AttentionService } from './attention.service';
import * as f from './format';
import { Icon } from './icon.component';
import { SessionView } from './session-view';

/** Une entrée à traiter (panneau de la cloche et toasts) : session (ce qu'elle attend, depuis quand, de quoi la débloquer) ou alerte de conso. */
@Component({
  selector: 'app-attention-item',
  imports: [Icon, RouterLink, HlmButton],
  template: `
    @if (row(); as r) {
    <span [class]="'dot dot-' + r.s.state" aria-hidden="true"></span>
    <div class="lines">
      <p class="row">
        <span class="what" [class.wait]="r.urgent">{{ r.label }}</span>
        <span class="title">{{ r.s.title }}</span>
        <span class="age mono" [class.wait]="r.urgent"><span class="sr-only">depuis </span>{{ f.duration(r.age) }}</span>
      </p>
      <p class="sub" [class.wait]="r.urgent" [class.mono]="r.urgent">{{ r.urgent ? r.doing : 'Claude a fini son tour' }}</p>
      <div class="actions">
        @if (r.canAllow) {
          <button hlmBtn variant="wait" size="sm" [attr.aria-label]="'Autoriser : ' + r.s.title" (click)="attention.reply(r.s.id, 'allow')">Autoriser</button>
          <button hlmBtn variant="outline" size="sm" [attr.aria-label]="'Refuser : ' + r.s.title" (click)="attention.reply(r.s.id, 'refuse')">Refuser</button>
        }
        <a hlmBtn size="sm" [variant]="r.canAllow ? 'ghost' : r.urgent ? 'wait' : 'outline'" [routerLink]="['/sessions', r.s.id]" (click)="go.emit()">{{ r.urgent && !r.canAllow ? 'Répondre' : 'Ouvrir' }}</a>
      </div>
      @if (attention.replyError()?.id === r.s.id) { <p class="error" role="alert">{{ attention.replyError()?.message }}</p> }
    </div>
    } @else if (alert(); as a) {
    <svg appIcon="usage" class="picto" width="14" height="14"></svg>
    <div class="lines">
      <p class="row"><span class="title">{{ a.title }}</span></p>
      <p class="sub">{{ a.body }}</p>
      <div class="actions">
        <a hlmBtn variant="outline" size="sm" routerLink="/usage" (click)="go.emit()">Voir</a>
        <button hlmBtn variant="ghost" size="sm" (click)="attention.dismiss(a)">{{ a.dismissLabel }}</button>
      </div>
    </div>
    }
  `,
  styles: `
    :host { display: flex; gap: 10px; flex: 1; min-width: 0; }
    .dot { margin-top: 5px; }
    .picto { flex: none; margin-top: 2px; color: var(--faint); }
    .lines { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .row { display: flex; align-items: baseline; gap: 8px; margin: 0; min-width: 0; }
    .what { flex: none; font-size: 12px; font-weight: 600; color: var(--text-2); }
    .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .age { flex: none; font-size: 11px; color: var(--faint); }
    .sub { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-muted); overflow-wrap: anywhere; }
    .wait { color: var(--wait); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .error { margin: 0; font-size: 12px; color: var(--err); }
  `,
})
export class AttentionItemComponent {
  readonly row = input<SessionView | null>(null);
  readonly alert = input<UsageAlert | null>(null);
  /** Clic sur Ouvrir / Répondre / Voir : le panneau se ferme (un toast se ferme seul en ouvrant sa session). */
  readonly go = output();
  protected readonly attention = inject(AttentionService);
  protected readonly f = f;
}
