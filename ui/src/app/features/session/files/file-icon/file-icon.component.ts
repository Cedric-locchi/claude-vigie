import { Component, computed, input } from '@angular/core';
import { fileIcon } from './file-icon';

/** Tracés des glyphes (24 × 24, trait). */
const GLYPHS = {
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM20 15l-5-5L5 20M10 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  dir: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  open: 'M3 17V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1M3 17l2.2-6.6A1 1 0 0 1 6.1 10H21l-2.6 8.2a1 1 0 0 1-1 .8H5a2 2 0 0 1-2-2',
} as const;

/**
 * Icône de type devant un nom de fichier (arbre, onglets, « Aller au fichier ») : badge ou glyphe en `--faint`.
 * Décorative (aria-hidden) : le nom suit toujours. `kind` : dossier fermé ou ouvert pour l'arbre.
 */
@Component({
  selector: 'app-file-icon',
  host: { 'aria-hidden': 'true' },
  template: `
    @let i = icon();
    @if ('badge' in i) { <span class="badge">{{ i.badge }}</span> }
    @else { <svg viewBox="0 0 24 24"><path [attr.d]="glyphs[i.glyph]" /></svg> }
  `,
  styles: `
    :host { flex: none; display: inline-grid; place-items: center; width: 18px; height: 16px; color: var(--faint); }
    svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    /* Badge serré dans la case de 18 px : 11 px (plancher de DESIGN.md), centré. */
    .badge { font: 600 11px/1 var(--mono); letter-spacing: -0.06em; white-space: nowrap; }
  `,
})
export class FileIconComponent {
  readonly path = input('');
  readonly kind = input<'file' | 'dir' | 'open'>('file');
  protected readonly glyphs = GLYPHS;
  protected readonly icon = computed(() => (this.kind() === 'file' ? fileIcon(this.path()) : { glyph: this.kind() as 'dir' | 'open' }));
}
