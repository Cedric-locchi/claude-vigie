import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import * as f from '../../../core/format';
import { ActivityDay, ActivityGrid, weeksFor } from './activity-grid';

const DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Heatmap des tokens par jour, autant de semaines que la largeur en tient : un carré par jour actif (plus foncé = plus de tokens), un point par jour vide, pic, détail du jour survolé. */
@Component({
  selector: 'app-activity-grid',
  template: `
    @let g = grid();
    <section class="activity" aria-labelledby="activity-title">
      <header>
        <div>
          <h2 id="activity-title"><svg class="bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>Activité</h2>
          <p class="small">
            Tokens par jour sur {{ g.weeks.length }} semaines · <span class="mono">{{ g.activeDays }}</span> jour{{ g.activeDays > 1 ? 's' : '' }} actif{{ g.activeDays > 1 ? 's' : '' }}
            @if (g.streak > 1) { · série de <span class="mono">{{ g.streak }}</span> j }
          </p>
        </div>
        <p class="peak small">Pic : @if (g.peak; as p) { <span class="mono">{{ f.tokens(p.tokens) }} tokens</span> ({{ short(p.day) }}) } @else { <span class="faint">aucune activité</span> }</p>
      </header>

      <p class="sr-only">
        {{ f.tokens(g.tokens) }} tokens sur les {{ g.weeks.length }} dernières semaines, {{ g.activeDays }} jours actifs@if (g.peak; as p) {, pic le {{ date(p.day) }} avec {{ f.tokens(p.tokens) }} tokens}.
        Le détail jour par jour est dans la page Consommation.
      </p>

      <div class="scroll" #scroll>
        <div class="grid" [style.--weeks]="g.weeks.length" aria-hidden="true" (mouseleave)="hover.set(null)">
          @for (m of g.months; track m.col) {
            <span class="month" [style.grid-column]="m.col + 2">{{ m.label }}</span>
          }
          <span class="wd" style="grid-row: 3">lun</span>
          <span class="wd" style="grid-row: 5">mer</span>
          <span class="wd" style="grid-row: 7">ven</span>
          @for (week of g.weeks; track $index; let w = $index) {
            @for (d of week; track d.day; let i = $index) {
              @if (!d.future) {
                <span class="cell" [attr.data-level]="d.level" [class.on]="hover() === d" [style.grid-column]="w + 2" [style.grid-row]="i + 2"
                  [attr.title]="date(d.day) + ' : ' + (d.tokens ? f.tokens(d.tokens) + ' tokens' : 'aucune activité')" (mouseenter)="hover.set(d)"></span>
              }
            }
          }
        </div>
      </div>

      <footer class="small">
        <span class="detail" aria-hidden="true">
          @if (hover(); as d) {
            <span class="day">{{ date(d.day) }}</span> ·
            @if (d.tokens) { <span class="mono">{{ f.tokens(d.tokens) }}</span> tokens · <span class="mono">{{ d.sessions }}</span> session{{ d.sessions > 1 ? 's' : '' }} · <span class="mono">{{ f.usd(d.cost) }}</span> } @else { aucune activité }
          } @else {
            <svg class="info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>Survole un jour pour voir son détail.
          }
        </span>
        <span class="legend" aria-hidden="true">
          Moins
          @for (l of levels; track l) { <span class="cell" [attr.data-level]="l"></span> }
          Plus
        </span>
      </footer>
    </section>
  `,
  styles: `
    .activity { border: 1px solid var(--edge); border-radius: 12px; box-shadow: var(--elev-1); background: var(--surface); padding: 14px 18px; display: flex; flex-direction: column; gap: 14px; }
    header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; }
    h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }
    .bolt { width: 18px; height: 18px; flex: none; fill: var(--brand); }
    .info { display: inline-block; width: 14px; height: 14px; margin-right: 6px; vertical-align: -2px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; color: var(--faint); }
    .small { color: var(--text-muted); font-size: 12px; }
    .mono { font-family: var(--mono); color: var(--text); }
    .peak .mono { font-weight: 500; }
    .faint { color: var(--faint); }

    /* Sous 13 semaines de cases de 14px, la grille défile ; la semaine en cours reste visible (direction rtl). */
    .scroll { overflow-x: auto; direction: rtl; container-type: inline-size; }
    .grid {
      /* Autant de semaines que la largeur en tient (weeksFor) ; la case absorbe le reste au pixel près (14 à 18px) ;
         1px de marge pour qu'un arrondi ne fasse pas apparaître de barre de défilement. */
      --cell: clamp(14px, (100cqi - 29px) / var(--weeks) - 3px, 26px);
      direction: ltr; display: grid; gap: 3px; width: max-content;
      grid-template-columns: 28px repeat(var(--weeks), var(--cell)); grid-template-rows: 16px repeat(7, var(--cell));
    }
    .month, .wd { font-size: 11px; color: var(--faint); white-space: nowrap; align-self: center; }
    .month { grid-row: 1; }
    .wd { grid-column: 1; }
    /* Échelle de la secondaire (décision 042) : niveau 1 à 75 % sur la carte = 3,0:1 en clair (5,1:1 en sombre) ; 0 = simple point neutre. */
    .cell { border-radius: 3px; }
    .cell[data-level='0'] { background: radial-gradient(circle, var(--faint) 2px, transparent 2.5px); }
    .cell[data-level='1'] { background: color-mix(in oklch, var(--data) 75%, var(--surface)); }
    .cell[data-level='2'] { background: color-mix(in oklch, var(--data) 83%, var(--surface)); }
    .cell[data-level='3'] { background: color-mix(in oklch, var(--data) 92%, var(--surface)); }
    .cell[data-level='4'] { background: var(--data); }
    .cell.on { outline: 2px solid var(--text); }

    footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-height: 18px; }
    .day { display: inline-block; color: var(--text); font-weight: 600; }
    .day::first-letter { text-transform: uppercase; }
    .legend { display: flex; align-items: center; gap: 3px; color: var(--faint); }
    .legend .cell { display: inline-block; width: 11px; aspect-ratio: 1; }
  `,
})
export class ActivityGridComponent {
  readonly grid = input.required<ActivityGrid>();
  /** Semaines que la largeur disponible tient (cf. weeksFor), émises à chaque redimensionnement. */
  readonly weeks = output<number>();
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');
  protected readonly hover = signal<ActivityDay | null>(null);
  protected readonly levels = [0, 1, 2, 3, 4];
  protected readonly f = f;
  protected date = (t: number) => DATE.format(t);
  protected short = (t: number) => SHORT.format(t);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([e]) => this.weeks.emit(weeksFor(e.contentRect.width)));
      ro.observe(this.scroll().nativeElement);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }
}
