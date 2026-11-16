import { Component, input } from '@angular/core';
import * as f from '../../core/format';
import { ActivityDay, ActivityGrid } from './activity-grid';

const DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Activité de l'année façon GitHub : une case par jour, plus verte quand il y a eu plus de sessions. */
@Component({
  selector: 'app-activity-grid',
  template: `
    @let g = grid();
    <section class="activity" aria-label="Activité de l'année">
      <header>
        <span class="label">Activité</span>
        <span class="small">{{ g.total }} session{{ g.total > 1 ? 's' : '' }} sur {{ g.activeDays }} jour{{ g.activeDays > 1 ? 's' : '' }}, 12 derniers mois</span>
      </header>
      <div class="scroll">
        <div class="grid" [style.--weeks]="g.weeks.length" aria-hidden="true">
          @for (m of g.months; track m.col) {
            <span class="month" [style.grid-column]="m.col + 2">{{ m.label }}</span>
          }
          <span class="wd" style="grid-row: 3">lun</span>
          <span class="wd" style="grid-row: 5">mer</span>
          <span class="wd" style="grid-row: 7">ven</span>
          @for (week of g.weeks; track $index; let w = $index) {
            @for (d of week; track d.day; let i = $index) {
              @if (!d.future) {
                <span class="cell" [attr.data-level]="d.level" [style.grid-column]="w + 2" [style.grid-row]="i + 2" [title]="tip(d)"></span>
              }
            }
          }
        </div>
      </div>
      <footer class="small" aria-hidden="true">
        Moins
        @for (l of levels; track l) { <span class="cell" [attr.data-level]="l"></span> }
        Plus
      </footer>
    </section>
  `,
  styles: `
    .activity { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); padding: 12px 18px; display: flex; flex-direction: column; gap: 8px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .label { font-weight: 600; }
    .small { color: var(--faint); font-size: 12px; }
    /* Défile à l'horizontale sur un écran étroit, la semaine en cours reste visible (direction rtl). */
    .scroll { overflow-x: auto; direction: rtl; }
    .grid {
      direction: ltr; display: inline-grid; gap: 3px;
      grid-template-columns: 24px repeat(var(--weeks), 11px); grid-template-rows: 14px repeat(7, 11px);
    }
    .month, .wd { font-size: 10px; color: var(--faint); line-height: 11px; white-space: nowrap; }
    .month { grid-row: 1; }
    .wd { grid-column: 1; }
    .cell { width: 11px; height: 11px; border-radius: 2px; background: var(--surface-2); outline: 1px solid color-mix(in oklch, var(--text) 6%, transparent); outline-offset: -1px; }
    .cell[data-level='1'] { background: color-mix(in oklch, var(--ok) 30%, var(--surface-2)); }
    .cell[data-level='2'] { background: color-mix(in oklch, var(--ok) 55%, var(--surface-2)); }
    .cell[data-level='3'] { background: color-mix(in oklch, var(--ok) 78%, var(--surface-2)); }
    .cell[data-level='4'] { background: var(--ok); }
    footer { display: flex; align-items: center; justify-content: flex-end; gap: 3px; }
    footer .cell { display: inline-block; }
  `,
})
export class ActivityGridComponent {
  readonly grid = input.required<ActivityGrid>();
  protected readonly levels = [0, 1, 2, 3, 4];

  protected tip(d: ActivityDay): string {
    const date = DATE.format(d.day);
    return d.sessions ? `${date} : ${d.sessions} session${d.sessions > 1 ? 's' : ''} · ${f.usd(d.cost)}` : `${date} : aucune session`;
  }
}
