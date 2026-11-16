import { Component, inject } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { Icon } from '../../../../core/icon.component';
import { FileIconComponent } from '../file-icon/file-icon.component';
import { SessionFilesVm, base, isDirty } from '../session-files.vm';

/**
 * Onglets des fichiers ouverts, façon JetBrains : icône de type et nom en 13 px, l'actif souligné de 2 px en bleu, l'aperçu
 * en italique (double-clic pour le garder), un point pour une saisie non enregistrée, × au survol ; clic milieu ferme.
 * Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-tabs',
  imports: [Icon, HlmTooltip, FileIconComponent],
  host: { role: 'group', 'aria-label': 'Fichiers ouverts' },
  template: `
    @let a = vm.active()?.path;
    @for (tab of vm.tabs(); track tab.path) {
      <div class="tab" [class.on]="tab.path === a" [class.preview]="tab.preview" (dblclick)="vm.pin(tab.path)"
        (auxclick)="$event.button === 1 && vm.close(tab.path)" (mousedown)="$event.button === 1 && $event.preventDefault()">
        <button type="button" class="tab-name" [attr.aria-current]="tab.path === a ? 'page' : null" [hlmTooltip]="tab.path + (tab.preview ? ' (aperçu : double-clic pour le garder)' : '')" [showDelay]="500" (click)="vm.activate(tab.path)">
          <app-file-icon [path]="tab.path" /><span class="tn">{{ name(tab.path) }}</span>@if (tab.preview) { <span class="sr-only">, aperçu</span> }
        </button>
        <button type="button" class="tab-x" [class.dirty]="dirty(tab)" [attr.aria-label]="'Fermer ' + name(tab.path) + (dirty(tab) ? ', modifié' : '')" (click)="vm.close(tab.path)">
          <span class="dot" aria-hidden="true"></span><svg appIcon="close" class="ic"></svg>
        </button>
      </div>
    }
  `,
  styles: `
    :host { min-width: 0; display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: none; }
    .tab { position: relative; flex: none; display: flex; align-items: center; color: var(--text-muted); transition: color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease); }
    .tab:hover { color: var(--text); background: var(--hover); }
    .tab.on { color: var(--text); }
    /* Soulignement de l'onglet actif, posé sur le filet du bas de la bande. */
    .tab::after { content: ''; position: absolute; inset: auto 0 0; height: 2px; background: var(--brand); transform: scaleX(0); transition: transform var(--dur) var(--ease); }
    .tab.on::after { transform: scaleX(1); }
    .tab.preview .tab-name { font-style: italic; }
    .tab-name { display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 2px 0 10px; border: 0; background: none; color: inherit; font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
    .tab-x { position: relative; display: grid; place-items: center; width: 18px; height: 18px; margin: 0 6px 0 2px; border: 0; border-radius: 4px; background: none; color: var(--faint); cursor: pointer; }
    .tab-x:hover { background: var(--press); color: var(--text); }
    .tab-x .ic { width: 12px; height: 12px; stroke-width: 1.8; }
    .dot { position: absolute; width: 7px; height: 7px; border-radius: 50%; background: var(--text-2); visibility: hidden; }
    /* × au survol de l'onglet ou au focus ; un onglet modifié montre son point à la place. */
    .tab:not(:hover) .tab-x:not(:focus-visible) .ic { visibility: hidden; }
    .tab-x.dirty .dot { visibility: visible; }
    .tab:hover .tab-x.dirty .dot, .tab-x.dirty:focus-visible .dot { visibility: hidden; }
    :is(.tab-name, .tab-x):focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; border-radius: 4px; }
    @media (prefers-reduced-motion: reduce) { .tab, .tab::after { transition: none; } }
  `,
})
export class FilesTabsComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly name = base;
  protected readonly dirty = isDirty;
}
