import { Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import * as f from '../../../core/format';
import { ActivityGridComponent } from '../activity-grid/activity-grid.component';
import { DashboardKpisComponent } from '../dashboard-kpis/dashboard-kpis.component';
import { Icon } from '../../../core/icon.component';
import { SessionsPageVm } from './sessions-page.vm';
import { PageComponent } from '../../../shell/page/page.component';

/**
 * Dashboard (route `/`, décision 041 et sa mise à jour) : indicateurs, heatmap d'activité, puis une seule liste de sessions par
 * date de création ; une session qui attend se repère à son badge, à son fond lavé et à ses actions, sans changer de place.
 */
@Component({
  selector: 'app-sessions-page',
  imports: [PageComponent, Icon, ActivityGridComponent, DashboardKpisComponent, NgTemplateOutlet, RouterLink, HlmBadge, HlmButton, HlmCheckbox, HlmEmptyImports, HlmInputGroupImports, HlmKbd, HlmTooltip],
  providers: [SessionsPageVm],
  template: `
    <app-page>
      <header pageHeader>
        <h1>Dashboard</h1>
        <div class="tools">
          <div hlmInputGroup class="search">
            <input hlmInputGroupInput type="search" aria-label="Rechercher une session" placeholder="Rechercher…" [value]="vm.search()" (input)="vm.setSearch($any($event.target).value)" />
            <div hlmInputGroupAddon><svg appIcon="search" width="15" height="15"></svg></div>
          </div>
          <a hlmBtn routerLink="/new">Nouvelle session @if (vm.mac) { <kbd hlmKbd>⌘N</kbd> }</a>
        </div>
      </header>

      @if (vm.unreachable()) {
        <div hlmEmpty class="unreachable" role="alert">
          <div hlmEmptyHeader>
            <div hlmEmptyTitle>Vigie ne joint pas le daemon</div>
            <div hlmEmptyDescription>
              Vérifie qu'il tourne avec <span class="mono">vigie status</span>, lance-le avec <span class="mono">vigie start</span>, ou relance l'app.
              Cette page se met à jour dès qu'il répond.
            </div>
          </div>
        </div>
      } @else if (vm.loading()) {
        <p class="muted">Connexion au daemon…</p>
      } @else {
        <app-dashboard-kpis />

        @if (vm.activity(); as grid) { <app-activity-grid [grid]="grid" (weeks)="vm.activityWeeks.set($event)" /> }

        <section class="block" aria-labelledby="list-title">
          <h2 id="list-title">Sessions</h2>
          @if (vm.selected().length; as n) {
            <div class="bulk panel" role="group" aria-label="Sélection">
              <span class="small" aria-live="polite"><span class="mono">{{ n }}</span> sélectionnée{{ n > 1 ? 's' : '' }}</span>
              <button hlmBtn variant="destructive" size="sm" (click)="vm.removeSelected()">Supprimer la sélection</button>
              <button hlmBtn variant="ghost" size="sm" (click)="vm.clearSelection()">Annuler</button>
            </div>
          }

          <div class="board panel" role="table" aria-labelledby="list-title">
            @if (vm.rows().length) {
              <div class="row head" role="row">
                <span role="columnheader" class="state"><hlm-checkbox aria-label="Sélectionner toutes les sessions affichées" [checked]="vm.allSelected()" [indeterminate]="vm.someSelected()" (checkedChange)="vm.toggleAll($event)" />État</span><span role="columnheader">Session</span><span role="columnheader">Activité</span><span role="columnheader" class="c-spark">15 min</span><span role="columnheader" class="c-agents">Agents</span><span role="columnheader" class="num-col">Durée</span><span role="columnheader" class="num-col">Coût</span><span role="columnheader"><span class="sr-only">Actions</span></span>
              </div>
            }
            @for (r of vm.rows(); track r.s.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: r }" />
            } @empty {
              <div hlmEmpty>
                <div hlmEmptyHeader>
                  @if (vm.search()) {
                    <div hlmEmptyTitle>Aucune session ne correspond</div>
                    <div hlmEmptyDescription>Essaie un autre titre, projet ou branche.</div>
                  } @else {
                    <div hlmEmptyTitle>Aucune session aujourd'hui</div>
                    <div hlmEmptyDescription>Lance-en une pour la suivre ici.</div>
                  }
                </div>
                @if (!vm.search()) { <div hlmEmptyContent><a hlmBtn routerLink="/new">Nouvelle session @if (vm.mac) { <kbd hlmKbd>⌘N</kbd> }</a></div> }
              </div>
            }
          </div>
        </section>

        <!-- Ligne de session : l'état ne change que le badge, la couleur et les actions, jamais la place. -->
        <ng-template #row let-r>
            <div class="row" role="row" (click)="vm.openRow($event, r.s.id)" [class.urgent]="r.urgent" [class.wait-arrive]="r.urgent" [class.done]="r.s.state === 'done'">
              <span role="cell" class="state"><hlm-checkbox [aria-label]="'Sélectionner la session ' + r.s.title" [checked]="vm.selectedIds().has(r.s.id)" (checkedChange)="vm.toggle(r.s.id, $event)" /><span hlmBadge [variant]="r.s.state">{{ r.label }}</span></span>
              <span role="cell" class="who">
                <a [routerLink]="['/sessions', r.s.id]" class="title truncate">{{ r.s.title }}</a>
                <span class="small faint truncate">{{ r.s.project }}@if (r.s.branch) { · <span class="mono">{{ r.s.branch }}</span> }@if (!r.s.terminalId && r.s.state !== 'done') { · hors Vigie }</span>
              </span>
              <span role="cell" class="doing small" [class.wait]="r.urgent" [class.mono]="r.s.state === 'running' || r.urgent" [hlmTooltip]="r.doing" [showDelay]="400">{{ r.doing }}</span>
              <span role="cell" class="c-spark">
                <span class="spark" [class.stale]="r.stale" role="img" [attr.aria-label]="r.stale ? 'Aucune activité depuis 5 min' : 'Activité des 15 dernières minutes'" [hlmTooltip]="r.stale ? 'Aucune activité depuis 5 min : peut-être bloquée' : 'Appels API et outils par minute'">
                  @for (h of r.spark; track $index) { <i [style.--h]="h / 22"></i> }
                </span>
              </span>
              <span role="cell" class="c-agents small mono" [class.faint]="!r.s.subagents">@if (r.s.subagents) { {{ r.s.activeSubagents }}/{{ r.s.subagents }} } @else { — }</span>
              <span role="cell" class="num-col small mono" [class.wait]="r.urgent" [hlmTooltip]="r.urgent || r.s.state === 'turn' ? 'Attend depuis' : 'Durée de la session'"><span class="sr-only">{{ r.urgent || r.s.state === 'turn' ? 'Attend depuis ' : 'Durée ' }}</span>{{ f.duration(r.age) }}</span>
              <span role="cell" class="num-col small mono">{{ f.usd(r.s.cost) }}</span>
              <span role="cell" class="actions">
                @if (r.canAllow) {
                  <button hlmBtn variant="wait" size="sm" (click)="vm.allow(r.s)">Autoriser</button>
                  <button hlmBtn variant="outline" size="sm" (click)="vm.refuse(r.s)">Refuser</button>
                } @else if (!r.s.terminalId) {
                  <button hlmBtn size="sm" [variant]="r.urgent ? 'wait' : 'outline'" hlmTooltip="Ouvre la session dans un terminal Vigie (claude --resume)" (click)="vm.resume(r.s)">Reprendre</button>
                } @else if (r.s.state === 'waiting' || r.s.state === 'turn') {
                  <a hlmBtn size="sm" [variant]="r.urgent ? 'wait' : 'outline'" [routerLink]="['/sessions', r.s.id]">Répondre</a>
                }
                <button hlmBtn variant="ghost" size="icon-sm" class="del" [attr.aria-label]="'Supprimer la session ' + r.s.title" hlmTooltip="Supprimer" (click)="vm.remove(r.s)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>
              </span>
              @if (r.canAllow && vm.replyError()?.id === r.s.id) { <p class="reply-error small" role="cell"><span role="alert">{{ vm.replyError()?.message }}</span></p> }
            </div>
        </ng-template>
      }
    </app-page>
  `,
  styles: `
    header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; }
    h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
    .tools { display: flex; align-items: center; gap: 10px; }
    .search { width: 16rem; }
    /* Téléphone : la recherche prend la largeur restante à côté du bouton, plus rien ne déborde. */
    @media (max-width: 720px) {
      .tools { flex: 1 1 100%; }
      .search { flex: 1; width: auto; min-width: 0; }
    }

    /* Sections nommées : titre posé sur le fond pointillé, contenu en carte. */
    .block { display: flex; flex-direction: column; gap: 12px; }
    h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }

    .board { overflow: hidden; }
    .row {
      display: grid; align-items: center; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--line);
      grid-template-columns: 118px minmax(180px, 1.3fr) minmax(160px, 1.6fr) 96px 56px 64px 64px 190px;
    }
    .row:last-child { border-bottom: 0; }
    /* Toute la ligne ouvre la session (le lien du titre reste la cible clavier). */
    .row:not(.head) { cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
    .row:not(.head):hover { background: var(--hover); }
    .row:not(.head):active { background: var(--press); }
    .row:not(.head):hover .title { color: var(--brand); }
    .row.urgent:hover { background: color-mix(in oklch, var(--wait-bg), var(--wait) 8%); }
    .row.urgent:active { background: color-mix(in oklch, var(--wait-bg), var(--wait) 14%); }
    .row.head { padding-top: 10px; padding-bottom: 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); }
    .row { position: relative; }
    .row.urgent { background: var(--wait-bg); }
    /* Barre d'état : se trace de haut en bas à l'arrivée de l'attente (transform, aucun reflow). */
    .row.urgent::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--wait); transform-origin: top; animation: bar-draw 420ms var(--ease-out); }
    @keyframes bar-draw { from { transform: scaleY(0); } }
    /* Terminée : en retrait par la couleur, pas l'opacité, pour garder le texte lisible (4,5:1). */
    .row.done .title { color: var(--text-muted); }
    .row.done .doing { color: var(--faint); }
    /* Case de sélection devant le badge : la cellule État s'élargit de 26px plutôt qu'une colonne de plus. */
    .state { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px 8px 18px; }
    .bulk > :first-child { margin-right: auto; color: var(--text-2); }
    .num-col { text-align: right; white-space: nowrap; }
    .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title { color: var(--text); font-weight: 600; transition: color var(--dur-fast) var(--ease); }
    .doing.wait { color: var(--wait); }
    .doing { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .spark { display: flex; align-items: flex-end; gap: 2px; height: 22px; border-bottom: 1px solid var(--line-strong); }
    /* Hauteur portée par scaleY (--h de 0 à 1) : le composite suffit, pas de reflow à chaque snapshot. */
    .spark i { flex: 1; height: 100%; border-radius: 1px 1px 0 0; background: var(--data); transform: scaleY(var(--h, 0)); transform-origin: bottom; transition: transform var(--dur) var(--ease), background-color var(--dur) var(--ease); }
    .spark.stale { border-bottom-style: dashed; }
    .done .spark i { background: var(--read); }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
    .del { color: var(--faint); }
    .reply-error { grid-column: 1 / -1; color: var(--err); text-align: right; }
    .unreachable [hlmEmptyTitle] { color: var(--err); }
    .del:hover { background: var(--err-bg); color: var(--err); }

    @media (max-width: 1200px) {
      .row { grid-template-columns: 118px minmax(160px, 1fr) minmax(140px, 1.2fr) 64px 64px 170px; }
      .c-spark, .c-agents { display: none; }
    }
    @media (max-width: 820px) {
      .row { grid-template-columns: 1fr auto; row-gap: 8px; }
      .row.head { display: none; }
      .state { grid-column: 1; } .actions { grid-column: 2; grid-row: 1; }
      .who, .doing { grid-column: 1 / -1; }
      .num-col { text-align: left; }
    }
  `,
})
export class SessionsPageComponent {
  protected readonly vm = inject(SessionsPageVm);
  protected readonly f = f;
}
