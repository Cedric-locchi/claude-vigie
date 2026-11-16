import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, viewChild } from '@angular/core';
import type { Draw, PlotModule } from '../usage-charts';
import { reloadIfStale } from '../../../stale-build';

/** Plot n'est chargé qu'ici : chunk séparé, jamais dans le chargement initial. */
let plotModule: Promise<PlotModule> | null = null;
// Un échec n'est pas gardé : un nouvel essai reste possible (ex. après une reconnexion).
const loadPlot = () => (plotModule ??= import('@observablehq/plot').catch((e) => { plotModule = null; throw e; }));

/**
 * Hôte d'un graphique Observable Plot : charge Plot, mesure sa largeur (ResizeObserver) et redessine.
 * L'alternative accessible est portée par l'hôte (role="img" + aria-label), le SVG est décoratif pour les lecteurs d'écran.
 */
@Component({
  selector: 'app-plot-chart',
  template: `<div #box></div>@if (failed()) { <p class="small faint">Graphique indisponible (chargement de la bibliothèque impossible).</p> }`,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  styles: `:host { display: block; min-width: 0; min-height: 120px; } :host ::ng-deep svg { display: block; }`,
})
export class PlotChartComponent {
  readonly draw = input.required<Draw>();
  readonly label = input.required<string>();

  protected readonly failed = signal(false);
  private readonly plot = signal<PlotModule | null>(null);
  private readonly width = signal(0);
  private readonly box = viewChild.required<ElementRef<HTMLDivElement>>('box');

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    loadPlot().then((p) => this.plot.set(p), (e) => { if (!reloadIfStale(e, location.pathname + location.search)) this.failed.set(true); });
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([e]) => this.width.set(Math.floor(e.contentRect.width)));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
    effect(() => {
      const [Plot, width, draw] = [this.plot(), this.width(), this.draw()];
      if (!Plot || !width) return;
      const svg = draw(Plot, width);
      svg.setAttribute('aria-hidden', 'true');
      this.box().nativeElement.replaceChildren(svg);
    });
  }
}
