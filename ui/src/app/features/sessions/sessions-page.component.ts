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
          <div class="now">
            <p class="headline" [class.hot]="k.blocked" aria-live="polite">
              @if (k.blocked) { {{ k.blocked }} session{{ k.blocked > 1 ? 's t’attendent' : ' t’attend' }}. }
              @else if (k.turn) { À toi sur {{ k.turn }} session{{ k.turn > 1 ? 's' : '' }}. }
              @else if (k.running) { Rien ne t’attend, {{ k.running }} session{{ k.running > 1 ? 's travaillent' : ' travaille' }}. }
              @else { Tout est calme. }
            </p>
            <ul class="pills">
              <li class="kpi" [class.hot]="k.blocked" [class.zero]="!k.blocked"><i class="dot"></i><span class="mono">{{ k.blocked }}</span> en attente</li>
              @if (k.turn) { <li class="kpi turn"><i class="dot"></i><span class="mono">{{ k.turn }}</span> à toi</li> }
              <li class="kpi run" [class.zero]="!k.running"><i class="dot"></i><span class="mono">{{ k.running }}</span> en cours</li>
              <li class="kpi" [class.zero]="!k.subagents"><span class="mono">{{ k.subagents }}</span> sous-agent{{ k.subagents > 1 ? 's' : '' }} actif{{ k.subagents > 1 ? 's' : '' }}</li>
              <li class="kpi zero"><span class="mono">{{ k.doneToday }}</span> terminée{{ k.doneToday > 1 ? 's' : '' }} aujourd’hui</li>
            </ul>
          </div>
          <a class="usage" routerLink="/usage" aria-label="Consommation : voir le détail">
            <span class="line"><span class="label">Aujourd’hui</span><span class="mono strong">{{ f.usd(k.todayCost) }}</span></span>
            @if (k.window; as w) {
              <span class="line">
                <span class="label">Fenêtre 5 h</span>
                <hlm-progress class="gauge" [value]="w.bar" aria-label="Fenêtre de 5 h utilisée"><hlm-progress-indicator /></hlm-progress>
                <span class="mono strong">{{ f.pct(w.pct) }}</span>
              </span>
              <span class="sub">@if (w.limitAt) { <span class="limit">limite vers {{ f.clock(w.limitAt) }}</span> } @else if (w.end) { reset dans {{ f.duration(w.end - vm.now()) }} }</span>
            } @else {
              <span class="line"><span class="label">Fenêtre 5 h</span><span class="faint">aucune ouverte</span></span>
            }
            <svg appIcon="chevron" class="go" width="14" height="14"></svg>
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

    /* Bandeau : une ligne d'état (phrase + pastilles) à gauche, la consommation en petit à droite. */
    .kpis { display: flex; align-items: stretch; justify-content: space-between; gap: 24px; padding: 14px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .now { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .headline { font-size: 16px; font-weight: 600; }
    .headline.hot { color: var(--wait); }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .kpi { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; color: var(--text-2); white-space: nowrap; }
    .kpi .mono { font-family: var(--mono); font-weight: 600; color: var(--text); }
    .kpi.zero { color: var(--faint); }
    .kpi.zero .mono { color: var(--faint); font-weight: 400; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); }
    .kpi.run:not(.zero) .dot { background: var(--brand); }
    .kpi.turn { border-color: var(--wait-line); color: var(--wait); }
    .kpi.turn .dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--wait); }
    .kpi.hot { background: var(--wait-bg); border-color: var(--wait-line); color: var(--wait); }
    .kpi.hot .mono { color: var(--wait); }
    .kpi.hot .dot { background: var(--wait); }

    .usage { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 8px 32px 8px 20px; margin: -8px -10px -8px 0; border-left: 1px solid var(--line); border-radius: 0 8px 8px 0; color: var(--text-2); font-size: 12px; transition: background-color var(--dur-fast) var(--ease); }
    .usage:hover { background: var(--hover); }
    .usage:active { background: var(--press); }
    .usage:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .line { display: flex; align-items: center; gap: 10px; }
    .label { width: 72px; color: var(--faint); }
    .strong { color: var(--text); font-weight: 600; margin-left: auto; }
    .gauge { width: 120px; }
    .sub { padding-left: 82px; color: var(--text-muted); }
    .limit { color: var(--text); font-weight: 600; }
    .faint { color: var(--faint); }
    .go { position: absolute; right: 10px; top: 50%; translate: 0 -50%; color: var(--faint); transition: transform var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .usage:hover .go { color: var(--brand); transform: translateX(2px); }

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
      .row { grid-template-columns: 118px minmax(160px, 1fr) minmax(140px, 1.2fr) 64px 64px 170px; }
      .c-spark, .c-agents { display: none; }
    }
    @media (max-width: 820px) {
      .row { grid-template-columns: 1fr auto; row-gap: 8px; }
      .row.head { display: none; }
      .state { grid-column: 1; } .actions { grid-column: 2; grid-row: 1; }
      .who, .doing { grid-column: 1 / -1; }
      .num-col { text-align: left; }
      .kpis { flex-direction: column; }
      .usage { border-left: 0; border-top: 1px solid var(--line); margin: 0 -18px -14px; padding: 12px 18px; border-radius: 0 0 12px 12px; }
    }
  `,
})
export class SessionsPageComponent {
  protected readonly vm = inject(SessionsPageVm);
  protected readonly f = f;
}
