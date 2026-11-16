import { Component, ElementRef, afterNextRender, inject, input, output, viewChild, Injector } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmToggle } from '@spartan-ng/helm/toggle';
import { waitLabel } from '../../core/session-view';
import { GanttComponent } from './gantt.component';
import { ALL_KINDS, KIND_LABELS } from './timeline';
import { StepDetailComponent } from './step-detail.component';
import { Icon } from '../../core/icon.component';
import { TimelineVm } from './timeline.vm';

/**
 * Chronologie d'une session, découpée en tours (un message de l'humain → tout ce qui suit).
 * Gantt de toute la session en couloirs en haut, puis chaque tour en cascade : une ligne par étape, sous-agents imbriqués,
 * silences compressés, détail d'une étape au clic.
 */
@Component({
  selector: 'app-timeline',
  imports: [Icon, GanttComponent, HlmBadge, HlmButton, HlmEmptyImports, HlmInputGroupImports, HlmToggle, StepDetailComponent],
  providers: [TimelineVm],
  template: `
    @if (vm.failed()) {
      <p class="small text-err" role="alert">Chronologie indisponible : le daemon est-il à jour ? (redémarre-le après une mise à jour)</p>
    } @else if (vm.loading()) {
      <p class="small faint">Chargement de la chronologie…</p>
    } @else if (vm.trace(); as trace) {
      <app-gantt (turn)="jump($event)" (step)="reveal($event)" />

      <div class="toolbar">
        <div hlmInputGroup class="search">
          <input hlmInputGroupInput type="search" aria-label="Rechercher une étape" placeholder="Rechercher une étape, un fichier, une commande…" [value]="vm.query()" (input)="vm.setQuery($any($event.target).value)" />
          <div hlmInputGroupAddon><svg appIcon="search" width="15" height="15"></svg></div>
        </div>
        <div class="kinds" role="group" aria-label="Types d'étapes">
          @for (k of kinds; track k) {
            <button hlmToggle variant="outline" size="sm" [state]="vm.kinds().has(k) ? 'on' : 'off'" (stateChange)="vm.toggleKind(k)">
              <i class="sw" [class]="'sw k-' + k" aria-hidden="true"></i>{{ kindLabels[k] }}
            </button>
          }
        </div>
        <button hlmToggle variant="outline" size="sm" [state]="vm.errorsOnly() ? 'on' : 'off'" (stateChange)="vm.setErrorsOnly($event === 'on')" [class.has-errors]="vm.counts().errors">
          Erreurs <span class="n">{{ vm.counts().errors }}</span>
        </button>
        @if (vm.filtering()) { <button hlmBtn variant="ghost" size="sm" (click)="vm.resetFilters()">Effacer les filtres</button> }
        <span class="total small faint">{{ vm.turns().length }} / {{ vm.counts().turns }} tours · {{ vm.counts().steps }} étapes</span>
      </div>

      <div #scroller class="turns" tabindex="-1">
        @for (t of vm.turns(); track t.index) {
          <section class="turn" [id]="'turn-' + t.index" [class.open]="t.open" [class.live]="t.live" [attr.aria-label]="'Tour ' + t.index">
            <button type="button" class="turn-head" [attr.aria-expanded]="t.open" (click)="vm.toggleTurn(t.index)">
              <svg appIcon="chevron" class="chev" width="14" height="14"></svg>
              <span class="turn-no">Tour {{ t.index }}</span>
              <span class="small faint mono">{{ t.time }}</span>
              @if (t.live) { <span hlmBadge variant="running">en cours</span> }
              <span class="prompt">{{ t.prompt || '(sans message)' }}</span>
              <span class="stats small">
                <span class="mono">{{ t.duration }}</span> · {{ t.tools }} étape{{ t.tools > 1 ? 's' : '' }}
                @if (t.agents) { · {{ t.agents }} agent{{ t.agents > 1 ? 's' : '' }} }
                @if (t.errors) { <span hlmBadge variant="issue">{{ t.errors }} erreur{{ t.errors > 1 ? 's' : '' }}</span> }
              </span>
            </button>

            @if (t.open) {
              <div class="cascade" role="table" [attr.aria-label]="'Étapes du tour ' + t.index">
                <div class="row axis" role="row">
                  <span role="columnheader" class="small faint">Étape</span>
                  <span role="columnheader" class="track">
                    <span class="tick mono" style="left: 0">0</span>
                    @for (b of t.scale.breaks; track $index) { <span class="tick break mono" [style.left.%]="b.left + b.width / 2">⋯ {{ b.label }}</span> }
                    <span class="tick end mono">{{ t.axisEnd }}</span>
                  </span>
                  <span role="columnheader" class="small faint dur">Durée</span>
                </div>

                @for (r of t.rows; track r.key) {
                  <div class="row step" role="row" [attr.data-step]="r.stepId" [class.selected]="r.stepId && vm.selected() === r.stepId" [class.error]="r.error" [style.--depth]="r.depth">
                    <span role="cell" class="label">
                      @if (r.children.length) {
                        <button type="button" class="twist" [attr.aria-expanded]="r.open" [attr.aria-label]="(r.open ? 'Replier ' : 'Déplier ') + r.name" (click)="vm.toggleRow(r.key)">
                          <svg class="chev" [class.on]="r.open" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                        </button>
                      } @else { <span class="twist" aria-hidden="true"></span> }
                      <button type="button" class="pick" [disabled]="!r.stepId && !r.children.length"
                        (click)="r.stepId ? vm.select(r.stepId) : vm.toggleRow(r.key)" [attr.aria-pressed]="r.stepId ? vm.selected() === r.stepId : null">
                        <i class="sw" [class]="'sw k-' + r.kind" aria-hidden="true"></i>
                        <span class="name">{{ r.name }}@if (r.count > 1) { <span class="faint"> ×{{ r.count }}</span> }</span>
                        @if (r.agent) { <span class="desc">{{ r.agent.name }} · {{ r.agent.description }}</span> }
                        @else if (r.label) { <span class="desc mono">{{ r.label }}</span> }
                        @if (r.error) { <svg class="err-mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg><span class="sr-only">, erreur</span> }
                      </button>
                    </span>
                    <span role="cell" class="track">
                      @for (b of t.scale.breaks; track $index) { <span class="gap" [style.left.%]="b.left" [style.width.%]="b.width"></span> }
                      <span class="bar" [class]="'bar k-' + r.kind" [class.running]="r.running" [class.err]="r.error" [class.interrupted]="r.interrupted"
                        [style.left.%]="r.left" [style.width.%]="r.width"></span>
                    </span>
                    <span role="cell" class="dur mono small" [class.text-err]="r.error">{{ r.running ? 'en cours' : r.interrupted ? 'interrompu' : r.duration }}</span>
                  </div>

                  @if (r.stepId && vm.selected() === r.stepId) {
                    <app-step-detail [style.--depth]="r.depth" [name]="r.name" [running]="r.running" [loading]="vm.detailLoading()" [detail]="vm.detail()" (openLog)="openLog.emit(r.label || r.name)" />
                  }
                }

                @if (t.waiting; as w) {
                  <div class="row step waiting" role="row">
                    <span role="cell" class="label"><span class="twist"></span><span class="pick static"><i class="sw k-wait" aria-hidden="true"></i><span class="name">{{ waitLabel(w.reason, 'long') }}</span><span class="desc mono">{{ w.detail }}</span></span></span>
                    <span role="cell" class="track"><span class="bar k-wait running" style="left: 96%; width: 4%"></span></span>
                    <span role="cell" class="dur mono small wait">maintenant</span>
                  </div>
                }
                @if (!t.rows.length && !t.waiting) { <p class="small faint none">Aucune étape : Claude a répondu sans utiliser d'outil.</p> }
              </div>
            }
          </section>
        } @empty {
          <div hlmEmpty>
            <div hlmEmptyHeader>
              <div hlmEmptyTitle>{{ vm.filtering() ? 'Aucune étape ne correspond' : 'Pas encore d’activité' }}</div>
              <div hlmEmptyDescription>{{ vm.filtering() ? 'Élargis les filtres ou change la recherche.' : 'La chronologie se remplit dès que Claude travaille.' }}</div>
            </div>
            @if (vm.filtering()) { <div hlmEmptyContent><button hlmBtn variant="outline" size="sm" (click)="vm.resetFilters()">Effacer les filtres</button></div> }
          </div>
        }
      </div>
    }
  `,
  styles: `
    /* Jamais de défilement latéral de la page : seul le bandeau défile sur le côté, à l'intérieur de son cadre. */
    :host { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
    .k-read { background: var(--read); } .k-edit { background: var(--brand); } .k-command { background: var(--cmd); }
    .k-agent { background: var(--ok); } .k-other { background: var(--neutral); } .k-wait { background: var(--wait); }
    app-gantt { flex: none; }

    /* Barre d'outils */
    .toolbar { flex: none; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .search { width: 300px; max-width: 100%; }
    .kinds { display: flex; flex-wrap: wrap; gap: 4px; }
    .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; flex: none; }
    .n { margin-inline-start: 4px; font-family: var(--mono); font-size: 11px; color: var(--faint); }
    .has-errors .n { color: var(--err); }
    .total { margin-inline-start: auto; }

    /* Tours */
    .turns { flex: 1; min-height: 0; min-width: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 8px; padding-bottom: 16px; outline: none; }
    .turn { flex: none; min-width: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); scroll-margin-top: 8px; }
    .turn.live { border-color: color-mix(in oklch, var(--brand) 45%, var(--line)); }
    .turn-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font: inherit; text-align: start; transition: background-color var(--dur-fast) var(--ease); }
    .turn-head:hover { background: var(--hover); }
    .turn-head:active { background: var(--press); }
    .turn-head:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .open .turn-head { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: 1px solid var(--line); }
    .chev { flex: none; color: var(--faint); transition: transform var(--dur) var(--ease); }
    .turn-head[aria-expanded='true'] .chev, .chev.on { transform: rotate(90deg); }
    .turn-no { flex: none; font-weight: 600; }
    .prompt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
    .stats { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; color: var(--text-muted); }

    /* Cascade */
    .cascade { display: flex; flex-direction: column; padding: 4px 0 8px; }
    .row > * { min-width: 0; }
    .row { display: grid; grid-template-columns: minmax(220px, 34%) minmax(0, 1fr) 82px; align-items: center; gap: 12px; padding: 0 14px; }
    .axis { height: 24px; }
    .track { position: relative; height: 100%; min-height: 22px; }
    .tick { position: absolute; top: 50%; transform: translateY(-50%); font-size: 10px; color: var(--faint); white-space: nowrap; }
    .tick.break { transform: translate(-50%, -50%); color: var(--text-muted); }
    .tick.end { right: 0; }
    .dur { text-align: end; color: var(--text-muted); white-space: nowrap; }
    .step { min-height: 28px; transition: background-color var(--dur-fast) var(--ease); }
    .step:hover { background: var(--hover); }
    .step.selected { background: var(--brand-bg); }
    .label { display: flex; align-items: center; min-width: 0; padding-inline-start: calc(var(--depth, 0) * 18px); }
    .twist { flex: none; display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--faint); }
    button.twist:hover { background: var(--press); color: var(--text); }
    .pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 4px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: start; }
    .pick:disabled { cursor: default; }
    .pick:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; border-radius: 4px; }
    .name { flex: none; font-weight: 500; }
    .desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-muted); }
    .err-mark { flex: none; margin-inline-start: auto; color: var(--err); }
    .gap { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, transparent 0 3px, var(--line) 3px 4px); opacity: 0.6; }
    .bar { position: absolute; top: 50%; height: 12px; min-width: 3px; transform: translateY(-50%); border-radius: 3px; transition: left var(--dur) var(--ease), width var(--dur) var(--ease); }
    .bar.err { box-shadow: 0 0 0 1.5px var(--err); }
    .bar.interrupted { opacity: 0.45; }
    /* Rayures « en cours » : un calque translaté (composite) plutôt qu'un fond repeint à chaque image. */
    .bar.running { overflow: hidden; }
    .bar.running::after { content: ''; position: absolute; inset: 0 0 0 -14px; background: repeating-linear-gradient(135deg, transparent 0 5px, rgb(255 255 255 / 0.25) 5px 10px) 0 0 / 14px 14px; animation: run 0.8s linear infinite; }
    @keyframes run { to { transform: translateX(14px); } }
    .step.error .name { color: var(--err); }
    .waiting .name { color: var(--wait); }
    .none { padding: 6px 14px; }

    @media (max-width: 900px) {
      .row { grid-template-columns: minmax(0, 1fr) 70px; }
      .row .track { display: none; }
      .stats .mono { display: none; }
    }
  `,
})
export class TimelineComponent {
  readonly sessionId = input.required<string>();
  /** Dernière activité de la session : déclenche le rechargement de la trace. */
  readonly lastTs = input.required<number>();
  /** « Voir dans le journal » : la page bascule sur le journal, filtré sur cette étape. */
  readonly openLog = output<string>();

  protected readonly vm = inject(TimelineVm);
  protected readonly kinds = ALL_KINDS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly waitLabel = waitLabel;
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    this.vm.connect(this.sessionId, this.lastTs);
  }

  /** Étape choisie dans le Gantt (déjà dépliée et sélectionnée par le VM) : l'amène au milieu de la cascade. */
  protected reveal(stepId: string): void {
    afterNextRender(() => {
      const row = [...(this.scroller()?.nativeElement.querySelectorAll<HTMLElement>('[data-step]') ?? [])].find((el) => el.dataset['step'] === stepId);
      row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, { injector: this.injector });
  }

  /** Clic sur un repère de tour : ouvre le tour et l'amène en haut de la liste. */
  protected jump(index: number): void {
    this.vm.openTurn(index);
    afterNextRender(() => {
      const el = this.scroller()?.nativeElement.querySelector<HTMLElement>(`#turn-${index}`);
      el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      el?.querySelector<HTMLElement>('.turn-head')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }
}
