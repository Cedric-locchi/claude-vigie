import { Component, inject, output } from '@angular/core';
import { Icon } from '../../../../core/icon.component';
import { SessionFilesVm } from '../session-files.vm';

/**
 * Barre d'état de la vue Fichiers, façon WebStorm : à gauche le fil d'Ariane du fichier actif (chaque segment le révèle
 * dans l'arbre) ; à droite position, fin de ligne, langage, branche git, « Non enregistré », et le cadenas « Claude travaille »
 * quand l'éditeur est en lecture seule. Sobre : pas de fond coloré. Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-status',
  imports: [Icon],
  template: `
    <nav class="crumbs" aria-label="Chemin du fichier">
      @for (c of vm.crumbs(); track c.path; let last = $last) {
        <button type="button" class="crumb" [class.here]="last" [attr.aria-current]="last ? 'location' : null"
          [attr.aria-label]="'Montrer ' + c.path + ' dans l’arbre'" (click)="reveal.emit(c.path)">{{ c.name }}</button>
        @if (!last) { <svg appIcon="chevron" class="sep"></svg> }
      }
    </nav>
    <div class="right">
      @if (!vm.idle()) {
        <span class="busy"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>Claude travaille<span class="sr-only"> : éditeur en lecture seule</span></span>
      }
      @if (vm.dirty()) { <span class="on">Non enregistré</span> }
      @if (vm.status(); as s) {
        @if (!vm.markdown()) { <span class="mono"><span class="sr-only">Ligne et colonne </span>{{ vm.position().line }}:{{ vm.position().col }}</span> }
        <span class="mono opt">{{ s.eol }}</span>
        <span class="opt">{{ s.lang ?? 'Texte brut' }}</span>
      }
      @if (vm.branch(); as b) {
        <span class="mono opt"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" /></svg><span class="sr-only">Branche </span>{{ b }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex; align-items: center; gap: 16px; height: 24px; padding: 0 8px 0 4px; overflow: hidden; white-space: nowrap;
      border-top: 1px solid var(--line); background: var(--nav); color: var(--faint); font-size: 12px;
    }
    .crumbs { flex: 1 1 0; min-width: 0; display: flex; align-items: center; overflow: hidden; }
    .crumb { flex: none; height: 20px; padding: 0 4px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
    .crumb:hover { background: var(--hover); color: var(--text); }
    .crumb.here { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
    .crumb:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .sep { flex: none; width: 12px; height: 12px; stroke-width: 1.6; stroke-linecap: round; color: var(--faint); }
    .right { flex: none; display: flex; align-items: center; gap: 14px; }
    .right > * { display: inline-flex; align-items: center; gap: 4px; }
    .ic { flex: none; width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .mono { font-size: 11px; }
    .on { color: var(--text); }
    .busy { color: var(--brand); }
    /* Étroit : le chemin, la position, « Non enregistré » et « Claude travaille » restent. */
    @media (max-width: 820px) { .opt { display: none; } }
  `,
})
export class FilesStatusComponent {
  protected readonly vm = inject(SessionFilesVm);
  /** Clic sur un segment : le parent le montre dans l'arbre et y met le focus. */
  readonly reveal = output<string>();
}
