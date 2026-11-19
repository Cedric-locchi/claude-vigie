import { Component, ElementRef, Injector, afterNextRender, inject, output, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { MAIN_LANE, nextLane } from '../timeline';
import { Icon } from '../../../../core/icon.component';
import { TimelineVm } from '../timeline.vm';

/**
 * Gantt de toute la session, en couloirs : agent principal puis un couloir par sous-agent.
 * Vue seule : l'état (zoom, sélection, filtres) vit dans le TimelineVm du parent ; ici, le câblage DOM
 * (mesure, défilement, molette, glissé sur l'axe, flèches entre les barres).
 */
@Component({
  selector: 'app-gantt',
  imports: [Icon, HlmButton, HlmTooltip],
  template: `
    @if (vm.gantt(); as g) {
      <div class="top">
        <div class="zoom" role="group" aria-label="Zoom de la chronologie">
          <button hlmBtn variant="ghost" size="icon-sm" aria-label="Dézoomer" [disabled]="vm.zoom() <= 1" (click)="zoomBy(0.5)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button hlmBtn variant="ghost" size="icon-sm" aria-label="Zoomer" [disabled]="vm.zoom() >= vm.maxZoom" (click)="zoomBy(2)">
            <svg appIcon="plus" width="15" height="15"></svg>
          </button>
          <button hlmBtn variant="ghost" size="sm" [disabled]="vm.zoom() <= 1" (click)="vm.resetZoom()">Tout voir</button>
        </div>
        <p class="readout small" aria-hidden="true">{{ vm.readout() ?? vm.zoomHint }}</p>
        <span class="legend small" aria-hidden="true">
          <span><svg class="x" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6 6 18" /></svg>erreur</span>
          @if (g.wait) { <span><i class="sw k-wait"></i>attend</span> }
        </span>
      </div>
      <p class="sr-only" [id]="sumId">Chronologie de la session : {{ g.summary }} Flèches pour passer d'une étape à l'autre, Entrée pour ouvrir son détail.</p>

      <div #view class="view" (wheel)="onWheel($event)">
        <div class="grid" [style.--rows]="g.lanes.length" [style.--canvas]="canvasPx() ? canvasPx() + 'px' : null">
          <div #corner class="corner"></div>
          <div class="axis" (pointerdown)="onAxisDown($event)" (pointermove)="onAxisMove($event)" (pointerup)="onAxisUp()" (pointercancel)="vm.drag.set(null)">
            @for (l of g.labels; track l.key) {
              @if (l.turn !== null) {
                <button type="button" [class]="'lbl turn mono ' + l.align" [style.left.%]="l.left"
                  [hlmTooltip]="g.turnTitles.get(l.turn)!" [attr.aria-label]="'Aller au ' + g.turnTitles.get(l.turn)" (click)="turn.emit(l.turn)">{{ l.text }}</button>
              } @else {
                 <span [class]="'lbl mono ' + l.align" [class.now]="l.key === 'now'" [class.gap-l]="l.gap" [style.left.%]="l.left">{{ l.text }}</span>
              }
            }
          </div>
          <div class="layer" aria-hidden="true">
            @for (b of g.scale.breaks; track $index) { <span class="gap" [style.left.%]="b.left" [style.width.%]="b.width"></span> }
            @for (t of g.turns; track t.index) { <span class="mark" [style.left.%]="t.x"></span> }
            @if (g.now !== null) { <span class="mark now" style="left: calc(100% - 1px)"></span> }
            @if (vm.drag(); as d) { <span class="sel" [style.left.%]="min(d.from, d.to) * 100" [style.width.%]="abs(d.to - d.from) * 100"></span> }
          </div>

          @for (lane of g.lanes; track lane.id; let i = $index) {
            <div class="head" [style.grid-row]="i + 2" [hlmTooltip]="lane.description ? lane.name + ' · ' + lane.description : lane.name">
              <i class="dot" [class.main]="lane.id === main" aria-hidden="true"></i><span class="name">{{ lane.name }}</span>
            </div>
            <div class="lane" role="toolbar" [style.grid-row]="i + 2" [attr.aria-label]="'Couloir ' + lane.name + (lane.description ? ', ' + lane.description : '')"
              [attr.aria-describedby]="i === 0 ? sumId : null" (keydown)="onKey($event)" (mouseleave)="vm.readout.set(null)">
              @for (b of lane.blocks; track b.key) {
                <button type="button" [class]="'b k-' + b.kind" [class.dim]="b.dim" [class.err]="b.error" [class.run]="b.end === null" [class.int]="b.interrupted"
                  [class.many]="b.count > 1" [class.sel]="b.count === 1 && vm.selected() === b.bars[0].stepId"
                  [style.left.%]="b.left" [style.width.%]="b.width" [attr.tabindex]="b.key === g.tab ? 0 : -1" [attr.aria-label]="b.aria"
                  (click)="pick(b)" (focus)="vm.focusBar(b.key, b.aria)" (mouseenter)="vm.readout.set(b.aria)">
                  @if (b.showCount) { <span class="n mono">×{{ b.count }}</span> }
                  @if (b.error) { <svg class="x" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg> }
                </button>
              }
              @if (lane.id === main && g.wait; as w) {
                <span class="wait" role="img" aria-label="Claude attend une réponse" [style.width]="'max(8px, ' + (w.right - w.left) + '%)'"></span>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { flex: none; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--elev-1); background: var(--surface); overflow: hidden; --head: 148px; --lane-h: 20px; }
    .k-read { background: var(--read); } .k-edit { background: var(--brand); } .k-command { background: var(--text-2); }
    .k-agent { background: var(--data); } .k-other { background: var(--neutral); } .k-wait { background: var(--wait); }
    .top { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 8px; border-bottom: 1px solid var(--line); }
    .zoom { flex: none; display: flex; align-items: center; gap: 2px; }
    .readout { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
    .legend { flex: none; display: flex; gap: 10px; color: var(--text-muted); }
    .legend > span { display: inline-flex; align-items: center; gap: 4px; }
    .legend .x { color: var(--err); }
    .sw { width: 8px; height: 8px; border-radius: 2px; }

    .view { max-height: min(38dvh, 232px, 30cqh); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .grid { position: relative; display: grid; width: calc(var(--head) + var(--canvas, 0px)); min-width: 100%; grid-template-columns: var(--head) var(--canvas, minmax(0, 1fr)); grid-template-rows: 28px repeat(var(--rows), var(--lane-h)); }
    .corner, .axis { position: sticky; top: 0; z-index: 2; grid-row: 1; background: var(--surface); border-bottom: 1px solid var(--line); }
    .corner { left: 0; z-index: 4; grid-column: 1; }
    .axis { grid-column: 2; touch-action: pan-y; cursor: crosshair; user-select: none; }
    .lbl { position: absolute; top: 1px; height: 13px; padding: 0 2px; border: 0; border-radius: 3px; background: transparent; font-size: 10px; line-height: 13px; white-space: nowrap; color: var(--faint); transform: translateX(-50%); }
    .lbl.start { transform: none; } .lbl.end { transform: translateX(-100%); }
    .lbl.turn { color: var(--text-2); font-weight: 600; cursor: pointer; }
    .lbl.turn:hover { background: var(--hover); }
    .lbl.turn:focus-visible { outline: 2px solid var(--brand); }
    .lbl.now { color: var(--brand); }
    .lbl.gap-l { top: 14px; color: var(--text-muted); }
    .layer { position: relative; grid-column: 2; grid-row: 1 / -1; pointer-events: none; }
    .gap { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, transparent 0 3px, var(--line) 3px 4px); }
    .mark { position: absolute; top: 28px; bottom: 0; border-left: 1px dashed var(--line-strong); }
    .mark.now { border-left: 1px solid var(--brand); }
    .sel { position: absolute; top: 0; bottom: 0; background: color-mix(in oklch, var(--brand) 18%, transparent); border-inline: 1px solid var(--brand); }

    .head { position: sticky; left: 0; z-index: 3; grid-column: 1; display: flex; align-items: center; gap: 6px; min-width: 0; padding: 0 8px; background: var(--surface); border-right: 1px solid var(--line); font-size: 12px; color: var(--text-2); }
    .head .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--data); }
    .dot.main { background: var(--text-muted); }
    .lane { position: relative; grid-column: 2; z-index: 1; border-bottom: 1px solid color-mix(in oklch, var(--line) 40%, transparent); }

    .b { position: absolute; top: 5px; height: 10px; min-width: 3px; padding: 0; border: 0; border-radius: 2px; scroll-margin-inline: calc(var(--head) + 8px) 8px; cursor: pointer; transition: opacity var(--dur) var(--ease); }
    .b:hover { filter: brightness(1.15); }
    .b:focus-visible, .b.sel { outline: 2px solid var(--brand); outline-offset: 1px; z-index: 1; }
    .b.many { top: 3px; height: 14px; display: grid; place-items: center; }
    .b.dim { opacity: 0.2; }
    .b.int { opacity: 0.5; }
    .b.err { box-shadow: 0 0 0 1.5px var(--err); }
    .b .x { position: absolute; left: calc(100% + 2px); top: 50%; transform: translateY(-50%); color: var(--err); }
    .n { font-size: 10px; font-weight: 600; line-height: 1; color: var(--bg); }
    /* Étape en cours : rayures qui glissent (coupées par « réduire les animations », règle globale). */
    .b.run { overflow: hidden; }
    .b.run::after { content: ''; position: absolute; inset: 0 0 0 -14px; background: repeating-linear-gradient(135deg, transparent 0 5px, rgb(255 255 255 / 0.25) 5px 10px) 0 0 / 14px 14px; animation: run 0.8s linear infinite; }
    @keyframes run { to { transform: translateX(14px); } }
    .wait { position: absolute; top: 4px; right: 0; height: 12px; min-width: 8px; border-radius: 2px; background: var(--wait); }

    @media (max-width: 600px) {
      :host { --head: 76px; }
      .readout, .legend { display: none; }
      .head { padding: 0 6px; font-size: 11px; }
    }
  `,
})
export class GanttComponent {
  /** Clic sur un repère de tour. */
  readonly turn = output<number>();
  /** Clic (ou Entrée) sur une étape : la cascade l'amène à l'écran. */
  readonly step = output<string>();

  protected readonly vm = inject(TimelineVm);
  protected readonly main = MAIN_LANE;
  protected readonly sumId = `gantt-sum-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly min = Math.min;
  protected readonly abs = Math.abs;
  private readonly injector = inject(Injector);
  private readonly view = viewChild<ElementRef<HTMLElement>>('view');
  private readonly corner = viewChild<ElementRef<HTMLElement>>('corner');

  constructor() {
    afterNextRender(() => {
      const view = this.view()?.nativeElement;
      if (!view) return;
      const measure = () => this.vm.setGanttWidth(view.clientWidth - (this.corner()?.nativeElement.offsetWidth ?? 0));
      new ResizeObserver(measure).observe(view);
      measure();
    });
  }

  /** Largeur du canevas en px (0 tant que non mesurée : la grille prend alors toute la place). */
  protected canvasPx(): number {
    return this.vm.ganttWidth() * this.vm.zoom();
  }

  /** Position du pointeur sur le canevas (fraction 0–1) et distance au bord gauche visible du canevas. */
  private pointer(clientX: number): { anchor: number; at: number } {
    const view = this.view()!.nativeElement;
    const head = this.corner()?.nativeElement.offsetWidth ?? 0;
    const at = clientX - view.getBoundingClientRect().left - head;
    return { anchor: (view.scrollLeft + at) / (this.canvasPx() || 1), at };
  }

  private scrollTo(left: number | null): void {
    if (left === null) return;
    afterNextRender(() => { const v = this.view()?.nativeElement; if (v) v.scrollLeft = left; }, { injector: this.injector });
  }

  protected zoomBy(factor: number): void {
    const view = this.view()?.nativeElement;
    if (!view) return;
    const w = this.vm.ganttWidth();
    this.scrollTo(this.vm.zoomBy(factor, (view.scrollLeft + w / 2) / (this.canvasPx() || 1), w / 2));
  }

  /** Ctrl (ou ⌘) + molette, et pincement du pavé tactile (même événement) : zoom sous le pointeur. */
  protected onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const { anchor, at } = this.pointer(e.clientX);
    this.scrollTo(this.vm.zoomBy(Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.01))), anchor, at));
  }

  protected onAxisDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.vm.dragStart(this.pointer(e.clientX).anchor);
  }

  protected onAxisMove(e: PointerEvent): void {
    if (this.vm.drag()) this.vm.dragMove(this.pointer(e.clientX).anchor);
  }

  protected onAxisUp(): void {
    this.scrollTo(this.vm.dragEnd());
  }

  protected pick(block: Parameters<TimelineVm['pick']>[0]): void {
    const scroll = this.vm.pick(block);
    if (scroll === null) this.step.emit(block.bars[0].stepId);
    else this.scrollTo(scroll);
  }

  /** Flèches : gauche / droite dans le couloir, haut / bas vers la barre la plus proche du couloir voisin non vide. */
  protected onKey(e: KeyboardEvent): void {
    const bar = (e.target as HTMLElement).closest<HTMLElement>('button.b');
    if (!bar) return;
    const bars = (lane: Element) => [...lane.querySelectorAll<HTMLElement>('button.b')];
    const lane = bar.parentElement!;
    const own = bars(lane);
    const i = own.indexOf(bar);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowRight') next = own[i + 1];
    else if (e.key === 'ArrowLeft') next = own[i - 1];
    else if (e.key === 'Home') next = own[0];
    else if (e.key === 'End') next = own.at(-1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const lanes = [...this.view()!.nativeElement.querySelectorAll('.lane')];
      const to = nextLane(lanes.map((l) => bars(l).length), lanes.indexOf(lane), e.key === 'ArrowUp' ? -1 : 1);
      const target = to === null ? undefined : lanes[to];
      const x = bar.offsetLeft;
      next = target && bars(target).sort((a, b) => Math.abs(a.offsetLeft - x) - Math.abs(b.offsetLeft - x))[0];
    } else return;
    e.preventDefault();
    next?.focus();
  }
}
