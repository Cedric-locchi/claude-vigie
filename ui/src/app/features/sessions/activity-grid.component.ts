import { Component, input, signal } from '@angular/core';
import * as f from '../../core/format';
import { ActivityDay, ActivityGrid } from './activity-grid';

const DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Activité de l'année façon GitHub : chiffres clés, une case par jour (plus verte = plus de sessions), détail du jour survolé. */
@Component({
  selector: 'app-activity-grid',
  template: `
    @let g = grid();
    <section class="activity" aria-label="Activité de l'année">
      <header>
        <div>
          <h2>Activité</h2>
          <p class="small">
            Tes 12 derniers mois, une case par jour.
            @if (g.streak > 1) { Tu enchaînes {{ g.streak }} jours d'affilée. } @else if (!g.total) { Aucune session pour l'instant. }
          </p>
        </div>
      </header>

      <dl class="stats">
        <div><dt>Sessions</dt><dd class="mono">{{ g.total }}</dd></div>
        <div><dt>Jours actifs</dt><dd class="mono">{{ g.activeDays }}</dd></div>
        <div><dt>Série en cours</dt><dd><span class="mono">{{ g.streak }}</span> j</dd></div>
        <div><dt>Plus longue série</dt><dd><span class="mono">{{ g.longest }}</span> j</dd></div>
        <div>
          <dt>Jour record</dt>
          <dd>@if (g.best; as b) { <span class="mono">{{ b.sessions }}</span><span class="faint">&nbsp;le {{ short(b.day) }}</span> } @else { <span class="faint">—</span> }</dd>
        </div>
        <div><dt>Coût estimé</dt><dd class="mono">{{ f.usd(g.cost) }}</dd></div>
      </dl>

      <div class="scroll">
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
                <span class="cell" [attr.data-level]="d.level" [class.on]="hover() === d" [style.grid-column]="w + 2" [style.grid-row]="i + 2" (mouseenter)="hover.set(d)"></span>
              }
            }
          }
        </div>
      </div>

      <footer class="small">
        <span class="detail">
          @if (hover(); as d) {
            <span class="day">{{ date(d.day) }}</span> ·
            @if (d.sessions) { <span class="mono">{{ d.sessions }}</span> session{{ d.sessions > 1 ? 's' : '' }} · <span class="mono">{{ f.usd(d.cost) }}</span> } @else { aucune session }
          } @else {
            Survole un jour pour voir son détail.
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
    .activity { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); padding: 14px 18px; display: flex; flex-direction: column; gap: 14px; }
    h2 { font-size: 16px; font-weight: 600; }
    .small { color: var(--text-muted); font-size: 12px; }
    .faint { color: var(--faint); }

    /* Chiffres clés : une rangée qui passe à la ligne, séparée de la grille par un filet. */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px 24px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
    .stats div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    dt { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
    dd { font-size: 14px; color: var(--text-muted); white-space: nowrap; }
    dd .mono, dd.mono { font-family: var(--mono); font-size: 18px; font-weight: 500; color: var(--text); }

    /* La grille prend toute la largeur ; sous ~700px elle défile, la semaine en cours reste visible (direction rtl). */
    .scroll { overflow-x: auto; direction: rtl; }
    .grid {
      /* Cases de 18px au plus : au-delà, la grille s'arrête plutôt que d'étirer les carrés. */
      direction: ltr; display: grid; gap: 3px; min-width: 640px; max-width: calc(28px + var(--weeks) * 21px);
      grid-template-columns: 28px repeat(var(--weeks), minmax(0, 1fr)); grid-template-rows: 16px;
    }
    .month, .wd { font-size: 11px; color: var(--faint); white-space: nowrap; align-self: center; }
    .month { grid-row: 1; }
    .wd { grid-column: 1; }
    .cell { aspect-ratio: 1; border-radius: 3px; background: var(--surface-2); outline: 1px solid color-mix(in oklch, var(--text) 6%, transparent); outline-offset: -1px; }
    .cell[data-level='1'] { background: color-mix(in oklch, var(--ok) 30%, var(--surface-2)); }
    .cell[data-level='2'] { background: color-mix(in oklch, var(--ok) 55%, var(--surface-2)); }
    .cell[data-level='3'] { background: color-mix(in oklch, var(--ok) 78%, var(--surface-2)); }
    .cell[data-level='4'] { background: var(--ok); }
    .cell.on { outline: 2px solid var(--text); outline-offset: 0; }

    footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-height: 18px; }
    .day { display: inline-block; color: var(--text); font-weight: 600; }
    .day::first-letter { text-transform: uppercase; }
    .detail .mono { font-family: var(--mono); color: var(--text); }
    .legend { display: flex; align-items: center; gap: 3px; color: var(--faint); }
    .legend .cell { display: inline-block; width: 11px; }
  `,
})
export class ActivityGridComponent {
  readonly grid = input.required<ActivityGrid>();
  protected readonly hover = signal<ActivityDay | null>(null);
  protected readonly levels = [0, 1, 2, 3, 4];
  protected readonly f = f;
  protected date = (t: number) => DATE.format(t);
  protected short = (t: number) => SHORT.format(t).replace('.', '');
}
