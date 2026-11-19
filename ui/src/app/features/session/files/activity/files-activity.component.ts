import { Component, inject } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { SessionFilesVm, SideView } from '../session-files.vm';

/** Fenêtres d'outils de la barre d'activité (nom, infobulle, tracé 24 × 24). */
export const VIEWS: { id: SideView; label: string; icon: string }[] = [
  { id: 'project', label: 'Projet', icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { id: 'search', label: 'Rechercher', icon: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5' },
  { id: 'claude', label: 'Claude', icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5' },
];

/**
 * Barre d'activité verticale, style JetBrains « New UI » : une icône par fenêtre d'outil (Projet, Rechercher, Claude).
 * La vue affichée est dans une case lavée de violet et ne réagit pas au clic ; panneau masqué (ou tiroir fermé), le clic le rouvre.
 * Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-activity',
  imports: [HlmTooltip],
  host: { role: 'navigation', 'aria-label': 'Fenêtres d’outils' },
  template: `
    @for (v of views; track v.id) {
      @let search = v.id === 'search';
      @let on = vm.isShown(v.id);
      @let busy = v.id === 'claude' && !!vm.here();
      <button type="button" class="act" [attr.data-view]="v.id" [attr.aria-current]="on || null" aria-controls="files-side" (click)="vm.showSide(v.id)"
        [attr.aria-label]="v.label + (busy ? ', Claude travaille' : '')" [attr.aria-keyshortcuts]="search ? vm.keys.aria + '+Shift+F' : null"
        [hlmTooltip]="search ? v.label + ' (' + vm.keys.mod + vm.keys.shift + 'F)' : v.label" position="right" [showDelay]="300">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="v.icon" /></svg>
        @if (busy) { <span class="busy" aria-hidden="true"></span> }
      </button>
    }
  `,
  styles: `
    /* Pilule verticale posée sur le fond pointillé (décision 043) : panneau à part, à la hauteur de ses icônes. */
    :host { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0; border: 1px solid var(--edge); border-radius: 22px; background: var(--surface); box-shadow: var(--elev-1); }
    .act {
      position: relative; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 10px; background: none;
      color: var(--faint); cursor: pointer; transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .act:not([aria-current]):hover { background: var(--hover); color: var(--text); }
    /* Vue affichée : case arrondie à fond lavé de la principale. */
    .act[aria-current='true'] { background: var(--brand-bg); color: var(--brand); cursor: default; }
    .act:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    /* Claude travaille : petit point bleu en coin (état « en cours »), absent au repos. */
    .busy { position: absolute; top: 7px; right: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--run); box-shadow: 0 0 0 2px var(--surface); }
  `,
})
export class FilesActivityComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly views = VIEWS;
}
