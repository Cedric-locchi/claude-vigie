import { Component, inject } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { ConfigPermissionsVm } from './config-permissions.vm';
import { KIND_LABEL, SCOPE_HINT, SCOPE_LABEL, kindBreakdown } from '../config-rules';

/**
 * Rubrique Permissions : compteurs par décision (filtres), recherche, puis une ligne par outil ou serveur MCP.
 * Portée et décision s'affichent une fois sur le groupe quand elles sont communes, sinon sur chaque règle.
 */
@Component({
  selector: 'app-config-permissions',
  imports: [HlmBadge, HlmInput, HlmTooltip],
  providers: [ConfigPermissionsVm],
  template: `
    <div class="toolbar">
      <div class="summary" role="group" aria-label="Filtrer par décision">
        @for (s of vm.summary(); track s.kind) {
          <button type="button" class="chip" [attr.aria-pressed]="vm.kind() === s.kind" [disabled]="!s.count && vm.kind() !== s.kind" (click)="vm.setKind(s.kind)">
            {{ s.label }} <span class="mono">{{ s.count }}</span>
          </button>
        }
        @if (vm.mode(); as mode) {
          <span class="small muted" hlmTooltip="Mode de la portée la plus prioritaire ; une option --permission-mode au lancement passe avant.">Mode par défaut <span class="mono">{{ mode }}</span></span>
        }
      </div>
      <input hlmInput type="search" class="search" placeholder="Rechercher une règle…" aria-label="Rechercher une règle" autocomplete="off"
        [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" />
    </div>

    <ul class="groups">
      @for (g of vm.groups(); track g.key) {
        <li>
          <details [open]="g.open" (toggle)="vm.toggle(g.key, $any($event).newState === 'open')">
            <summary>
              <span class="g-name mono">{{ g.label }}</span>
              @if (g.mcp) { <span class="small faint">MCP</span> }
              <span class="small faint">{{ g.rules.length }} {{ g.mcp ? 'outil' : 'règle' }}{{ g.rules.length > 1 ? 's' : '' }}</span>
              @if (g.conflicts) { <span class="small conflict">{{ g.conflicts }} remplacée{{ g.conflicts > 1 ? 's' : '' }}</span> }
              <span class="end">
                @if (g.scope; as sc) { <span hlmBadge variant="outline" [hlmTooltip]="scopeHint[sc]">{{ scopeLabel[sc] }}</span> }
                @if (g.kind; as k) { <span class="kind small">{{ kindLabel[k] }}</span> } @else { <span class="kind small">{{ breakdown(g.rules) }}</span> }
              </span>
            </summary>
            @if (g.open) {
              <ul class="rules">
                @for (r of g.rules; track $index) {
                  <li class="rule" [attr.data-status]="r.status">
                    <span class="detail mono" [title]="r.rule"><span class="head">{{ r.parts[0] }}</span><span>{{ r.parts[1] }}</span></span>
                    @switch (r.status) {
                      @case ('wins') { <span class="small status" title="La même règle existe ailleurs : Interdit passe avant Demander, puis Autorisé ; à décision égale, la portée la plus prioritaire.">l'emporte</span> }
                      @case ('overridden') { <span class="small status">remplacée par {{ kindLabel[r.by!.kind] }} · {{ scopeLabel[r.by!.scope] }}</span> }
                      @case ('duplicate') { <span class="small status">en double · {{ scopeLabel[r.by!.scope] }}</span> }
                    }
                    <span class="end">
                      @if (!g.scope) { <span hlmBadge variant="outline" [title]="scopeHint[r.scope]">{{ scopeLabel[r.scope] }}</span> }
                      @if (!g.kind) { <span class="kind small">{{ kindLabel[r.kind] }}</span> }
                    </span>
                  </li>
                }
              </ul>
            }
          </details>
        </li>
      } @empty {
        <li class="empty">Aucune règle ne correspond.</li>
      }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
    .summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px;
      background: transparent; color: var(--text-2); font: inherit; font-size: 12px;
      transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    .chip .mono { color: var(--text); }
    .chip:hover:not(:disabled) { background: var(--hover); }
    .chip:active:not(:disabled) { background: var(--press); }
    .chip[aria-pressed='true'] { background: var(--brand-bg); border-color: var(--brand); color: var(--text); }
    .chip:disabled { color: var(--faint); }
    .chip:focus-visible, summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .search { width: 240px; max-width: 100%; height: 32px; }

    .groups, .rules { margin: 0; padding: 0; list-style: none; }
    .groups > li { border-top: 1px solid var(--line); }
    .groups > li:first-child { border-top: 0; }
    summary {
      display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 6px; border-radius: 6px; list-style: none; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease);
    }
    summary::-webkit-details-marker { display: none; }
    summary:hover { background: var(--hover); }
    /* Chevron en masque pour prendre la couleur du texte ; pivote à l'ouverture. */
    summary::before {
      content: ''; flex: none; width: 12px; height: 12px; background: var(--faint);
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='m9 6 6 6-6 6'/%3E%3C/svg%3E") center / contain no-repeat;
      transition: transform var(--dur-fast) var(--ease);
    }
    details[open] > summary::before { transform: rotate(90deg); }
    .g-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
    .end { margin-inline-start: auto; display: flex; align-items: center; gap: 8px; flex: none; }
    .kind { min-width: 8ch; text-align: end; color: var(--text-2); }
    .conflict { color: var(--text); font-weight: 500; }

    .rules { padding: 0 0 6px 26px; }
    .rule { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 6px; border-top: 1px solid var(--line); }
    .detail { display: flex; min-width: 0; font-size: 12px; white-space: nowrap; }
    .head { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .status { flex: none; color: var(--text-2); }
    .rule[data-status='wins'] .status { color: var(--text); font-weight: 600; }
    .rule[data-status='overridden'] .detail { color: var(--faint); text-decoration: line-through; }
    .rule[data-status='duplicate'] .detail { color: var(--faint); }
    .empty { padding: 8px 0; font-size: 13px; color: var(--faint); }

    @media (max-width: 600px) {
      .search { width: 100%; }
      .rules { padding-inline-start: 8px; }
    }
  `,
})
export class ConfigPermissionsComponent {
  protected readonly vm = inject(ConfigPermissionsVm);
  protected readonly scopeLabel = SCOPE_LABEL;
  protected readonly scopeHint = SCOPE_HINT;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly breakdown = kindBreakdown;
}
