import { Component, inject } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { Icon } from '../../../../core/icon.component';
import { SessionFilesVm, base, isDirty } from '../session-files.vm';

/**
 * Onglets des fichiers ouverts : l'aperçu est en italique (double-clic pour le garder), un point signale une saisie
 * non enregistrée, clic milieu ferme. Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-tabs',
  imports: [Icon, HlmTooltip],
  template: `
    @let a = vm.active()?.path;
    @for (tab of vm.tabs(); track tab.path) {
      <div class="tab" [class.on]="tab.path === a" [class.preview]="tab.preview" (dblclick)="vm.pin(tab.path)"
        (auxclick)="$event.button === 1 && vm.close(tab.path)" (mousedown)="$event.button === 1 && $event.preventDefault()">
        <button type="button" class="tab-name mono" [attr.aria-current]="tab.path === a ? 'page' : null" [hlmTooltip]="tab.path + (tab.preview ? ' (aperçu : double-clic pour le garder)' : '')" [showDelay]="500" (click)="vm.activate(tab.path)">
          {{ name(tab.path) }}@if (tab.preview) { <span class="sr-only">, aperçu</span> }
        </button>
        @if (dirty(tab)) {
          <button type="button" class="tab-x dirty" [attr.aria-label]="'Fermer ' + name(tab.path) + ', modifié'" (click)="vm.close(tab.path)">
            <span class="dot" aria-hidden="true"></span><svg appIcon="close" class="ic"></svg>
          </button>
        } @else {
          <button type="button" class="tab-x" [attr.aria-label]="'Fermer ' + name(tab.path)" (click)="vm.close(tab.path)"><svg appIcon="close" class="ic"></svg></button>
        }
      </div>
    }
  `,
  styles: `
    :host { flex: none; display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: thin; background: var(--bg); box-shadow: inset 0 -1px 0 var(--line); }
    .tab { flex: none; display: flex; align-items: center; border-right: 1px solid var(--line); color: var(--text-muted); transition: background-color var(--dur-fast) var(--ease); }
    .tab:hover { background: var(--hover); color: var(--text); }
    /* Onglet actif : même surface que l'éditeur, il « perce » le filet du bas. */
    .tab.on { background: var(--surface); color: var(--text); box-shadow: inset 0 2px 0 var(--brand); }
    .tab.preview .tab-name { font-style: italic; }
    .tab-name { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 2px 0 12px; border: 0; background: none; color: inherit; font-size: 12px; }
    /* Fermer : visible sur l'onglet actif ou survolé ; un onglet modifié montre un point à la place, × au survol. */
    .tab-x { position: relative; display: grid; place-items: center; width: 22px; height: 22px; margin-right: 6px; border: 0; border-radius: 4px; background: none; color: var(--faint); }
    .tab:not(.on):not(:hover) .tab-x:not(:focus-visible) .ic { visibility: hidden; }
    .tab-x.dirty .dot { position: absolute; width: 8px; height: 8px; background: var(--text); }
    .tab-x.dirty:is(:hover, :focus-visible) .dot, .tab-x.dirty:not(:hover):not(:focus-visible) .ic { visibility: hidden; }
    .tab-x:hover { background: var(--press); color: var(--text); }
    .tab-x .ic { width: 12px; height: 12px; }
    .dot { flex: none; border-radius: 50%; }
    :is(.tab-name, .tab-x):focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    @media (max-width: 820px) { .tab-name { padding-left: 8px; } }
  `,
})
export class FilesTabsComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly name = base;
  protected readonly dirty = isDirty;
}
