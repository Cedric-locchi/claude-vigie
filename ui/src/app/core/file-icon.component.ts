import { Component, computed, input } from '@angular/core';
import { Glyph, iconFor } from './file-icon';

/** Tracés 16 × 16 : `s` en trait, `f` en aplat (evenodd : les découpes laissent voir le fond). */
const GLYPHS: Record<Glyph, { s?: string; f?: string }> = {
  file: { s: 'M9 1.75H4.5c-.69 0-1.25.56-1.25 1.25v10c0 .69.56 1.25 1.25 1.25h7c.69 0 1.25-.56 1.25-1.25V5.5zM9 1.75V5.5h3.75' },
  dir: { f: 'M1.5 4c0-.83.67-1.5 1.5-1.5h3.2l1.5 1.5H13c.83 0 1.5.67 1.5 1.5V12c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5z' },
  open: {
    s: 'M1.75 12V4c0-.69.56-1.25 1.25-1.25h3l1.5 1.5H12c.69 0 1.25.56 1.25 1.25V7',
    f: 'M3.6 7.25h11.2a.6.6 0 0 1 .57.78l-1.6 5a1 1 0 0 1-.95.72H1.9a.5.5 0 0 1-.48-.65l1.5-5.2a.9.9 0 0 1 .68-.65z',
  },
  ts: { f: 'M3.5 1.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM4.5 7h4.5v1.4H7.45v4.1h-1.4V8.4H4.5z' },
  js: { f: 'M3.5 1.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM10 7h1.4v4a1.6 1.6 0 0 1-1.6 1.6H8.5v-1.4h1.1a.4.4 0 0 0 .4-.4z' },
  react: {
    s: 'M14.5 8A6.5 2.4 0 1 1 1.5 8 6.5 2.4 0 1 1 14.5 8M11.25 13.63A6.5 2.4 60 1 1 4.75 2.37 6.5 2.4 60 1 1 11.25 13.63M4.75 13.63A6.5 2.4 120 1 1 11.25 2.37 6.5 2.4 120 1 1 4.75 13.63',
    f: 'M8 6.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z',
  },
  json: { s: 'M5.5 2.5c-1.5 0-2 .6-2 1.8v1.6c0 .9-.5 1.6-1.5 2.1 1 .5 1.5 1.2 1.5 2.1v1.6c0 1.2.5 1.8 2 1.8M10.5 2.5c1.5 0 2 .6 2 1.8v1.6c0 .9.5 1.6 1.5 2.1-1 .5-1.5 1.2-1.5 2.1v1.6c0 1.2-.5 1.8-2 1.8' },
  md: { s: 'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM4 10.5v-5l2 2.5 2-2.5v5M11.5 5.5v5M10 9l1.5 1.5L13 9' },
  html: { s: 'M5 4 1.75 8 5 12M11 4l3.25 4L11 12M9.25 3l-2.5 10' },
  css: { s: 'M6.5 2 5 14M11 2 9.5 14M2.5 5.5h11M2 10.5h11' },
  image: {
    s: 'M3 2.5h10c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V4c0-.83.67-1.5 1.5-1.5zM1.5 11 5 7.5l3 3 2-2 4.5 4',
    f: 'M10.5 4.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z',
  },
  yaml: { s: 'M2 3.5h5M4.5 6.5h6M4.5 9.5h9M2 12.5h5' },
  toml: { s: 'M2 4h12M2 8h12M2 12h12', f: 'M5 2.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM10.5 6.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM6.5 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z' },
  sh: { s: 'M2.5 2.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM4.5 6l2 2-2 2M8.5 10.5h3' },
  py: {
    f: 'M8 1.75c-2.1 0-3 .9-3 2.2V5.5h3.2v.6H3.6c-1.3 0-2 .9-2 2.6s.7 2.6 2 2.6H5V9.6c0-1 .8-1.8 1.8-1.8h2.6c.9 0 1.6-.7 1.6-1.6V3.95c0-1.2-.9-2.2-3-2.2zM8 14.25c2.1 0 3-.9 3-2.2V10.5H7.8v-.6h4.6c1.3 0 2-.9 2-2.6s-.7-2.6-2-2.6H11v1.7c0 1-.8 1.8-1.8 1.8H6.6c-.9 0-1.6.7-1.6 1.6v2.25c0 1.2.9 2.2 3 2.2z',
  },
  swift: { f: 'M13.9 10.6c.9-3.2-.9-6.6-4.6-8.9 1.7 2.3 2.4 4.9 1.8 7.1C8.9 7.3 5.6 5 2.9 2.7c2 2.4 4 4.4 6.2 6.2C6.6 8 4.1 6.5 2.1 4.8c2.2 3.4 5.4 6.1 8.6 7.7-2.6 1.3-5.6 1.4-8.6.3 2.4 1.9 5.6 2.6 8.6 1.6 1.4-.5 2.5.1 3.3.9.4-1.6-.1-3.4-.1-4.7z' },
  go: { s: 'M1 6.5h3M1.5 9h2.5M2.5 11.5h2M10.5 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z' },
  rust: { s: 'M8 3.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4zM8 1.5v2.3M8 12.2v2.3M1.5 8h2.3M12.2 8h2.3M3.4 3.4 5 5M11 11l1.6 1.6M3.4 12.6 5 11M11 5l1.6-1.6M8 6.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z' },
  lock: { s: 'M4 7.5h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5' },
  env: { s: 'M4 7.5h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5M8 10v1.75' },
  git: { s: 'M8 1.5 14.5 8 8 14.5 1.5 8zM6 6l2 2v2.75M8 8h2.5' },
  docker: { s: 'M1.5 8.5H13c.9 0 1.5-.6 1.5-1.4 0 0 .2 1.4-.6 2-.7 2.7-3 4.4-6.9 4.4-3.2 0-5.2-1.6-5.5-5z', f: 'M3.5 6h2v2h-2zM6.25 6h2v2h-2zM9 6h2v2H9zM6.25 3.25h2v2h-2z' },
};

/**
 * Icône de fichier ou de dossier (16 px) devant un nom : arbre, onglets, « Aller au fichier », Rechercher, Diff, barre d'état.
 * Décorative (aria-hidden) : le nom suit toujours. Couleur portée par un jeton (`--ft-*` / `--fd-*`), tracé en `currentColor`.
 */
@Component({
  selector: 'app-file-icon',
  host: { 'aria-hidden': 'true', '[attr.data-glyph]': 'icon().glyph', '[style.color]': 'icon().color' },
  template: `
    @let g = glyphs[icon().glyph];
    <svg viewBox="0 0 16 16">
      @if (g.f) { <path class="f" [attr.d]="g.f" /> }
      @if (g.s) { <path class="s" [attr.d]="g.s" /> }
    </svg>
  `,
  styles: `
    :host { flex: none; display: inline-grid; place-items: center; width: 16px; height: 16px; }
    svg { width: 16px; height: 16px; }
    .s { fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
    .f { fill: currentColor; fill-rule: evenodd; }
  `,
})
export class FileIconComponent {
  /** Nom ou chemin. */
  readonly name = input('');
  readonly dir = input(false);
  /** Dossier ouvert (arbre). */
  readonly open = input(false);
  protected readonly glyphs = GLYPHS;
  protected readonly icon = computed(() => iconFor(this.name(), this.dir(), this.open()));
}
