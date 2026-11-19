import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import * as f from '../../../core/format';
import { PlotChartComponent } from '../plot-chart/plot-chart.component';
import { UsagePageVm } from '../usage-page/usage-page.vm';
import { colorOf, compact, dayIndexAt } from '../usage-series';

/**
 * Graphique héros de la page Consommation : barres par jour (familles), cumul de la période (axe de droite), seuil,
 * et sous lui la bande des fenêtres de 5 h, alignée jour pour jour, qui sert aussi à choisir la période (glisser, clavier).
 * Vue seulement : l'état et la sélection vivent dans UsagePageVm (fourni par la page).
 */
@Component({
  selector: 'app-usage-hero',
  imports: [RouterLink, HlmButton, HlmCardImports, PlotChartComponent],
  template: `
    @let m = vm.margins();
    <section hlmCard class="hero" aria-labelledby="hero-title">
      <div class="head">
        <h2 id="hero-title">{{ vm.metricLabel() }} par jour · {{ vm.rangeLabel() }}@if (vm.family()) { · {{ vm.family() }} }</h2>
        <div class="tools">
          @if (vm.custom()) { <button hlmBtn variant="ghost" size="sm" (click)="vm.resetSelection()">Toute la période</button> }
          <span class="small muted">cumul <span class="mono total">{{ vm.format(vm.cumulTotal()) }}</span></span>
        </div>
      </div>

      @if (vm.daily().length) {
        <app-plot-chart class="pick" [draw]="vm.heroDraw()" [label]="vm.heroLabel()" />

        <div class="strip-row" [style.padding-left.px]="m.left" [style.padding-right.px]="m.right">
          <span class="strip-name small faint" [style.width.px]="m.left" aria-hidden="true">5 h</span>
          <div class="strip" tabindex="0" role="group" aria-roledescription="sélecteur de jours" aria-describedby="hero-help"
            [attr.aria-label]="'Fenêtres de 5 h et sélection : ' + vm.rangeLabel()"
            (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="vm.brushEnd()" (pointercancel)="vm.brushEnd()" (keydown)="key($event)">
            @for (b of vm.strip(); track b.start) {
              <i [class.est]="!b.real" [style.left.%]="b.left" [style.width.%]="b.width" [style.--lv]="b.level"></i>
            }
            @if (vm.custom()) { <span class="sel" [style.left.%]="vm.selectionBox().left" [style.width.%]="vm.selectionBox().width"></span> }
          </div>
        </div>
        <p id="hero-help" class="small faint help">Glisse sur la bande des fenêtres pour choisir des jours (flèches, Maj+flèches pour étendre, Échap : toute la période) · clic sur une barre : ce jour, Maj+clic : étendre</p>
        @if (vm.noWindows()) { <p class="small faint">Ton daemon ne fournit pas encore l'historique des fenêtres : redémarre-le après la mise à jour.</p> }
        <p class="sr-only" aria-live="polite">Sélection : {{ vm.rangeLabel() }}</p>

        <div class="legend small muted">
          @for (fam of vm.families(); track fam) { <span><i class="sw" [style.background]="color(fam)"></i>{{ fam }}</span> }
          <span><i class="ln"></i>cumul</span>
          @if (vm.threshold(); as t) {
            <span><i class="ln dash"></i>seuil {{ short(t) }}</span>
            @if (vm.overDays()) { <span><i class="ln over"></i>au-dessus du seuil</span> }
          } @else if (vm.metric() === 'cost') {
            <a routerLink="/settings">Régler un seuil</a>
          }
          <span><i class="sw blk"></i>5 h : % relevé</span>
          <span><i class="sw blk est"></i>estimé</span>
        </div>

        <table class="sr-only">
          <caption>{{ vm.metricLabel() }} par jour · {{ vm.rangeLabel() }}</caption>
          <thead><tr><th scope="col">Jour</th><th scope="col">Total</th><th scope="col">Cumul</th><th scope="col">Fenêtres de 5 h</th>@if (vm.threshold() != null) { <th scope="col">Seuil</th> }</tr></thead>
          <tbody>
            @for (d of vm.dayTotals(); track d.day) {
              <tr>
                <th scope="row">{{ date(d.day) }}</th><td>{{ vm.format(d.total) }}</td><td>{{ vm.format(d.cumul) }}</td>
                <td>{{ d.windows }}@if (d.peak != null) { , pic {{ f.pct(d.peak) }} }</td>
                @if (vm.threshold() != null) { <td>{{ d.over ? 'dépassé' : '' }}</td> }
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="empty small faint">{{ vm.loaded() ? 'Aucune consommation sur cette période : lance une session pour voir les barres apparaître.' : 'Chargement…' }}</p>
      }
    </section>
  `,
  styles: `
    .hero { padding: 16px 18px; gap: 10px; }
    .head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
    .tools { display: flex; align-items: center; gap: 12px; }
    h2 { margin: 0; font-size: 14px; font-weight: 600; }
    .total { color: var(--text); font-size: 16px; font-weight: 500; }
    .pick { cursor: pointer; }
    .empty { padding: 24px 0; }

    /* Bande des fenêtres : mêmes marges que le graphique, un jour = 1/n de la largeur. Manipulable au doigt (≥ 32 px). */
    .strip-row { position: relative; }
    .strip-name { position: absolute; left: 0; top: 0; height: 100%; display: flex; align-items: center; justify-content: flex-end; padding-right: 9px; }
    .strip {
      position: relative; height: 32px; border-radius: 6px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line);
      cursor: ew-resize; touch-action: none; user-select: none; overflow: hidden;
    }
    .strip:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    .strip i {
      position: absolute; top: 4px; bottom: 4px; min-width: 2px; border-radius: 2px;
      background: color-mix(in oklch, var(--data) calc(20% + var(--lv) * 80%), transparent);
    }
    .strip i.est { background: color-mix(in oklch, var(--read) calc(20% + var(--lv) * 80%), transparent); }
    .sel { position: absolute; top: 0; bottom: 0; border-radius: 6px; box-shadow: inset 0 0 0 2px var(--brand); background: color-mix(in oklch, var(--brand) 12%, transparent); pointer-events: none; }
    @media (max-width: 720px) { .strip { height: 40px; } }

    .help { margin: 0; }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
    .legend a { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
    .legend a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 2px; }
    .sw { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; vertical-align: -1px; }
    .sw.blk { background: var(--data); }
    .sw.blk.est { background: var(--read); }
    .ln { display: inline-block; width: 16px; margin-right: 6px; vertical-align: 3px; border-top: 2px solid var(--text); }
    .ln.dash { border-top: 1px dashed var(--text-muted); }
    .ln.over { border-top-color: var(--err); }
  `,
})
export class UsageHeroComponent {
  protected readonly vm = inject(UsagePageVm);
  protected readonly f = f;
  protected readonly color = colorOf;
  protected readonly short = compact('cost'); // le seuil n'existe qu'en coût
  protected readonly date = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Câblage DOM de la bande : position du pointeur → index de jour ; la logique de sélection est dans le VM.
  private index(e: PointerEvent): number {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return dayIndexAt(e.clientX - box.left, box.width, this.vm.spanDays().length);
  }
  protected down(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.vm.brushStart(this.index(e), e.shiftKey);
  }
  protected move(e: PointerEvent): void {
    this.vm.brushMove(this.index(e));
  }
  protected key(e: KeyboardEvent): void {
    if (this.vm.brushKey(e.key, e.shiftKey)) e.preventDefault();
  }
}
