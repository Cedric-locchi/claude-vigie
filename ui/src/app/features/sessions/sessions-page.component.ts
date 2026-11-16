import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import * as f from '../../core/format';
import { ActivityGridComponent } from './activity-grid.component';
import { Icon } from '../../core/icon.component';
import { SessionsPageVm } from './sessions-page.vm';

/** Vue globale façon salle de contrôle : indicateurs en direct, puis une ligne par session triée par urgence. */
@Component({
  selector: 'app-sessions-page',
  imports: [Icon, ActivityGridComponent, RouterLink, HlmBadge, HlmButton, HlmCheckbox, HlmEmptyImports, HlmInputGroupImports, HlmKbd, HlmProgressImports, HlmTooltip],
  providers: [SessionsPageVm],
  template: `
    <div class="page">
      <header>
        <h1>Sessions</h1>
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
        @let k = vm.kpis();
        <section class="kpis" aria-label="Indicateurs en direct">
          <div class="group" aria-label="Sessions">
            <div class="kpi" [class.hot]="k.blocked" [class.zero]="!k.blocked">
              <span class="label">@if (k.blocked) { <i class="dot wait"></i> }En attente</span>
              <span class="num">{{ k.blocked }}</span>
              <span class="sub">@if (k.blocked) { à débloquer } @else { rien ne te bloque }@if (k.turn) { · {{ k.turn }} à toi }</span>
            </div>
            <div class="kpi" [class.zero]="!k.running">
              <span class="label">@if (k.running) { <i class="dot run"></i> }En cours</span>
              <span class="num">{{ k.running }}</span>
              <span class="sub">{{ k.doneToday }} terminée{{ k.doneToday > 1 ? 's' : '' }} aujourd'hui</span>
            </div>
            <div class="kpi" [class.zero]="!k.subagents">
              <span class="label">Sous-agents</span>
              <span class="num">{{ k.subagents }}</span>
              <span class="sub">actifs en ce moment</span>
            </div>
          </div>
          <a class="group usage" routerLink="/usage" aria-label="Consommation : voir le détail">
            <div class="kpi">
              <span class="label">Coût aujourd'hui</span>
              <span class="num">{{ f.usd(k.todayCost) }}</span>
              <span class="sub">estimé</span>
            </div>
            <div class="kpi window">
              <span class="label">Fenêtre de 5 h <svg appIcon="chevron" class="go" width="14" height="14"></svg></span>
              @if (k.window; as w) {
                <span class="num">{{ f.pct(w.pct) }}</span>
                <hlm-progress [value]="w.bar" aria-label="Fenêtre de 5 h utilisée"><hlm-progress-indicator /></hlm-progress>
                <span class="sub">@if (w.limitAt) { <span class="limit">limite vers {{ f.clock(w.limitAt) }}</span> } @else if (w.end) { reset dans {{ f.duration(w.end - vm.now()) }} }</span>
              } @else {
                <span class="num faint">—</span><span class="sub">aucune fenêtre ouverte</span>
              }
            </div>
          </a>
        </section>

        @if (vm.activity(); as grid) { <app-activity-grid [grid]="grid" /> }

        @if (vm.selected().length; as n) {
          <div class="bulk" role="group" aria-label="Sélection">
            <span class="small" aria-live="polite"><span class="mono">{{ n }}</span> sélectionnée{{ n > 1 ? 's' : '' }}</span>
            <button hlmBtn variant="destructive" size="sm" (click)="vm.removeSelected()">Supprimer la sélection</button>
            <button hlmBtn variant="ghost" size="sm" (click)="vm.clearSelection()">Annuler</button>
          </div>
        }

        <section class="board" role="table" aria-label="Sessions">
          <div class="row head" role="row">
            <span role="columnheader" class="state"><hlm-checkbox aria-label="Sélectionner toutes les sessions affichées" [checked]="vm.allSelected()" [indeterminate]="vm.someSelected()" (checkedChange)="vm.toggleAll($event)" />État</span><span role="columnheader">Session</span><span role="columnheader">Activité</span><span role="columnheader" class="c-spark">15 min</span><span role="columnheader" class="c-agents">Agents</span><span role="columnheader" class="num-col">Durée</span><span role="columnheader" class="num-col">Coût</span><span role="columnheader"><span class="sr-only">Actions</span></span>
          </div>
          @for (r of vm.rows(); track r.s.id) {
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
              <span role="cell" class="num-col small mono">{{ f.usd(r.s.cost ?? 0) }}</span>
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
          } @empty {
            <div hlmEmpty>
              <div hlmEmptyHeader>
                <div hlmEmptyTitle>{{ vm.search() ? 'Aucune session ne correspond' : "Aucune session aujourd'hui" }}</div>
                <div hlmEmptyDescription>{{ vm.search() ? 'Essaie un autre titre, projet ou branche.' : 'Lance-en une pour la suivre ici.' }}</div>
              </div>
              @if (!vm.search()) { <div hlmEmptyContent><a hlmBtn routerLink="/new">Nouvelle session @if (vm.mac) { <kbd hlmKbd>⌘N</kbd> }</a></div> }
            </div>
          }
        </section>
      }
    </div>
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

    /* Bandeau : deux panneaux côte à côte, l'état des sessions à gauche, la consommation (cliquable) à droite. */
    .kpis { display: grid; grid-template-columns: 3fr 2fr; gap: 12px; }
    .group { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; color: var(--text); }
    .kpi { display: flex; flex-direction: column; gap: 4px; padding: 14px 18px; border-right: 1px solid var(--line); min-width: 0; }
    .kpi:last-child { border-right: 0; }
    .usage { grid-auto-columns: 1fr 1.4fr; transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
    .usage:hover { background: var(--hover); border-color: var(--line-strong); }
    .usage:active { background: var(--press); }
    .usage:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
    .go { margin-left: auto; color: var(--faint); transition: transform var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .usage:hover .go { color: var(--brand); transform: translateX(2px); }
    .num { font-family: var(--mono); font-size: 24px; font-weight: 500; }
    .sub { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .window hlm-progress { margin: 2px 0; }
    .limit { color: var(--text); font-weight: 600; }
    /* Zéro : le chiffre s'efface pour que l'œil aille aux valeurs non nulles. */
    .kpi.zero .num { color: var(--faint); }
    .dot { width: 7px; height: 7px; border-radius: 50%; }
    .dot.wait { background: var(--wait); box-shadow: 0 0 0 3px var(--wait-bg); }
    .dot.run { background: var(--brand); }
    .kpi.hot { background: var(--wait-bg); box-shadow: inset 3px 0 0 var(--wait); }
    .kpi.hot .num, .kpi.hot .label { color: var(--wait); }

    .board { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
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
    .bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px 8px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .bulk > :first-child { margin-right: auto; color: var(--text-2); }
    .num-col { text-align: right; white-space: nowrap; }
    .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title { color: var(--text); font-weight: 600; transition: color var(--dur-fast) var(--ease); }
    .doing.wait { color: var(--wait); }
    .doing { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .spark { display: flex; align-items: flex-end; gap: 2px; height: 22px; border-bottom: 1px solid var(--line-strong); }
    /* Hauteur portée par scaleY (--h de 0 à 1) : le composite suffit, pas de reflow à chaque snapshot. */
    .spark i { flex: 1; height: 100%; border-radius: 1px 1px 0 0; background: var(--brand); transform: scaleY(var(--h, 0)); transform-origin: bottom; transition: transform var(--dur) var(--ease), background-color var(--dur) var(--ease); }
    .spark.stale { border-bottom-style: dashed; }
    .done .spark i { background: var(--read); }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
    .del { color: var(--faint); }
    .reply-error { grid-column: 1 / -1; color: var(--err); text-align: right; }
    .unreachable [hlmEmptyTitle] { color: var(--err); }
    .del:hover { background: var(--err-bg); color: var(--err); }

    @media (max-width: 1200px) {
      .kpis { grid-template-columns: 1fr; }
      .row { grid-template-columns: 118px minmax(160px, 1fr) minmax(140px, 1.2fr) 64px 64px 170px; }
      .c-spark, .c-agents { display: none; }
    }
    @media (max-width: 820px) {
      .row { grid-template-columns: 1fr auto; row-gap: 8px; }
      .row.head { display: none; }
      .state { grid-column: 1; } .actions { grid-column: 2; grid-row: 1; }
      .who, .doing { grid-column: 1 / -1; }
      .num-col { text-align: left; }
      .group { grid-auto-flow: row; }
      .usage { grid-auto-columns: auto; }
      .kpi { border-right: 0; border-bottom: 1px solid var(--line); }
      .kpi:last-child { border-bottom: 0; }
    }
  `,
})
export class SessionsPageComponent {
  protected readonly vm = inject(SessionsPageVm);
  protected readonly f = f;
}
