import { Component, inject, output } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { SessionFilesVm, SideView } from '../session-files.vm';

/**
 * Barre d'activité de l'onglet Fichiers (Explorateur, Aller au fichier, Rechercher, Touchés par Claude) :
 * la vue affichée porte le filet bleu à gauche, comme la navigation, et ne réagit pas au clic (pas de repli). Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-activity',
  imports: [HlmTooltip],
  host: { role: 'navigation', 'aria-label': 'Vues de l’onglet Fichiers' },
  template: `
    @for (v of VIEWS; track v.id) {
      @if ($index === 1) {
        <button type="button" class="act-btn" aria-label="Aller au fichier" [attr.aria-keyshortcuts]="vm.keys.aria + '+P'" (click)="quick.emit()"
          [hlmTooltip]="'Aller au fichier (' + vm.keys.mod + 'P)'" position="right" [showDelay]="300">
          <svg class="ai" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v6M14 2l6 6v12a2 2 0 0 1-2 2H9M14 2v6h6M2 17h8M7 14l3 3-3 3" /></svg>
        </button>
      }
      @let n = v.id === 'claude' ? vm.touched().length : 0;
      @let search = v.id === 'search';
      @let on = vm.isShown(v.id);
      <button type="button" class="act-btn" [attr.aria-current]="on || null" aria-controls="files-side" (click)="vm.showSide(v.id)"
        [attr.aria-label]="v.label + (n ? ', ' + n : '')" [attr.aria-keyshortcuts]="search ? vm.keys.aria + '+Shift+F' : null"
        [hlmTooltip]="search ? v.label + ' (' + vm.keys.mod + vm.keys.shift + 'F)' : v.label" position="right" [showDelay]="300">
        <svg class="ai" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="v.icon" /></svg>
        @if (n) { <span class="badge mono" aria-hidden="true">{{ n > 99 ? '99+' : n }}</span> }
      </button>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; background: var(--bg); border-right: 1px solid var(--line); }
    .act-btn { position: relative; display: grid; place-items: center; height: 44px; border: 0; background: none; color: var(--faint); cursor: pointer; transition: color var(--dur-fast) var(--ease); }
    .act-btn:not([aria-current]):hover { color: var(--text); }
    .act-btn[aria-current='true'] { color: var(--text); box-shadow: inset 2px 0 0 var(--brand); cursor: default; }
    .act-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: -4px; }
    .ai { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .badge { position: absolute; right: 4px; bottom: 6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--surface-2); color: var(--text); font-size: 10px; line-height: 16px; text-align: center; }
  `,
})
export class FilesActivityComponent {
  protected readonly vm = inject(SessionFilesVm);
  readonly quick = output();
  protected readonly VIEWS: { id: SideView; label: string; icon: string }[] = [
    { id: 'tree', label: 'Explorateur', icon: 'M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7zM15 2v5h5M3 7v13a2 2 0 0 0 2 2h10' },
    { id: 'search', label: 'Rechercher', icon: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5' },
    { id: 'claude', label: 'Touchés par Claude', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  ];
}
