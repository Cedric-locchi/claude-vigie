import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { LOG_LABELS } from './attention';
import { AttentionItemComponent } from './attention-item.component';
import { AttentionService } from './attention.service';
import * as f from './format';

/**
 * Cloche (barre latérale et barre mobile) + panneau latéral droit.
 * « À traiter » se lit en direct dans le snapshot : on débloque une session d'ici, de n'importe quelle page.
 * « Plus tôt » : journal compact, regroupé par session. Réglages dans /settings.
 */
@Component({
  selector: 'app-notification-center',
  imports: [RouterLink, HlmButton, HlmSheetImports, HlmTooltip, AttentionItemComponent],
  template: `
    @let b = attention.bell();
    <button hlmBtn variant="ghost" size="icon-sm" class="bell" (click)="open.set(true)" hlmTooltip="Notifications" [attr.aria-label]="b.label">
      <!-- En pause : la cloche est barrée. -->
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />@if (attention.pausedUntil()) {<path d="M2 2l20 20" />}</svg>
      @if (b.waiting) { <span class="count mono" aria-hidden="true">{{ b.waiting }}</span> }
      @else if (b.others) { <span class="pip" aria-hidden="true"></span> }
    </button>

    <hlm-sheet side="right" autoFocus="first-heading" [state]="open() ? 'open' : 'closed'" (stateChanged)="open.set($event === 'open')">
      <hlm-sheet-content *hlmSheetPortal class="panel" closeLabel="Fermer les notifications">
        <hlm-sheet-header class="head">
          <h2 hlmSheetTitle>Notifications</h2>
          <p hlmSheetDescription>Ce qui t'attend, puis ce qui s'est passé plus tôt</p>
          @if (attention.pausedUntil(); as until) {
            <p class="pause" role="status">En pause jusqu'à <span class="mono">{{ f.clock(until) }}</span> : ni son ni notification système.
              <button hlmBtn variant="ghost" size="xs" (click)="attention.resume()">Reprendre</button></p>
          }
        </hlm-sheet-header>
        <div class="scroll">
          <h3 class="label">À traiter</h3>
          <ul class="list todo">
            @for (r of attention.pending(); track r.s.id) {
              <li class="item" [class.urgent]="r.urgent" [class.wait-arrive]="r.urgent"><app-attention-item [row]="r" (go)="open.set(false)" /></li>
            }
            @for (a of attention.usageAlerts(); track a.key) {
              <li class="item"><app-attention-item [alert]="a" (go)="open.set(false)" /></li>
            }
            @if (!attention.pending().length && !attention.usageAlerts().length) {
              <li class="empty">Rien à traiter. Une session qui attend ta réponse apparaîtra ici, avec de quoi la débloquer.</li>
            }
          </ul>

          @let history = attention.history();
          @if (history.length) {
            <div class="label later"><h3>Plus tôt</h3><button hlmBtn variant="ghost" size="xs" (click)="attention.clearHistory()">Effacer</button></div>
            <ul class="list">
              @for (g of history; track g.sessionId) {
                <li><a class="past" [routerLink]="['/sessions', g.sessionId]" (click)="open.set(false)">
                  <span class="title">{{ g.title }}</span>
                  <span class="kind">{{ labels[g.kind] }}</span>
                  <span class="mono times">{{ g.when }}@if (g.times.length > 1) { ×{{ g.times.length }} }</span>
                </a></li>
              }
            </ul>
          }
        </div>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
  styles: `
    :host { display: contents; }
    .bell { position: relative; }
    .count { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; display: grid; place-items: center; border-radius: 8px; background: var(--wait); color: var(--on-wait); font-size: 10px; font-weight: 600; line-height: 1; }
    .pip { position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; border-radius: 4px; background: var(--text-muted); box-shadow: 0 0 0 2px var(--nav); }
    .panel { width: min(560px, 100vw); max-width: none; padding: 0; gap: 0; }
    .head { padding: 16px 48px 12px 18px; border-bottom: 1px solid var(--line); }
    .pause { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; font-size: 12px; color: var(--text-2); }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; }
    .label { display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 14px 18px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); }
    .label h3 { font: inherit; margin: 0; }
    .list { margin: 0; padding: 0; list-style: none; }
    .item { display: flex; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--line); }
    .item.urgent { background: var(--wait-bg); box-shadow: inset 2px 0 0 var(--wait); }
    .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .empty { padding: 10px 18px 14px; font-size: 12px; line-height: 1.5; color: var(--faint); }
    .later { padding-top: 18px; }
    .past { display: flex; align-items: baseline; gap: 10px; padding: 8px 18px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--text-muted); transition: background-color var(--dur-fast) var(--ease); }
    .past:hover { background: var(--hover); }
    .past:active { background: var(--press); }
    .past:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
    .past .title { flex: 0 1 auto; color: var(--text-2); }
    .kind { flex: 1; white-space: nowrap; }
    .times { flex: none; font-size: 11px; color: var(--faint); }
  `,
})
export class NotificationCenterComponent {
  protected readonly attention = inject(AttentionService);
  protected readonly open = signal(false);
  protected readonly f = f;
  protected readonly labels = LOG_LABELS;
}
