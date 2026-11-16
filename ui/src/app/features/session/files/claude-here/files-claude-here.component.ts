import { Component, inject, input } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { FileIconComponent } from '../file-icon/file-icon.component';
import { FilesTouchedComponent } from '../touched/files-touched.component';
import { SessionFilesVm, base } from '../session-files.vm';

/**
 * « Claude ici » : le fichier que Claude lit ou modifie en ce moment (point bleu qui pulse) et la bascule « Suivre ».
 * `compact` (en tête de la vue Projet) : une seule ligne, seulement quand Claude travaille. Sinon (fenêtre d'outil Claude) :
 * la ligne, puis tous les fichiers touchés. Rien de lumineux quand Claude ne travaille pas (Lights-Out).
 * Vue seule : la logique est dans `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-claude-here',
  imports: [HlmTooltip, FileIconComponent, FilesTouchedComponent],
  template: `
    @let h = vm.here();
    @if (h || !compact()) {
      <!-- role=status : le changement de fichier est annoncé sans voler le focus. -->
      <div class="line" role="status">
        @if (h) {
          <button type="button" class="here" [class.on]="vm.active()?.path === h.path" [attr.title]="h.path" (click)="vm.open(h.path, true)">
            <span class="pulse" aria-hidden="true"></span>
            <span class="verb">Claude {{ h.edit ? 'modifie' : 'lit' }}</span>
            <app-file-icon [path]="h.path" />
            <span class="name">{{ name(h.path) }}</span>
            <span class="sr-only">{{ h.path }}</span>
          </button>
        } @else {
          <span class="idle">Claude ne travaille pas en ce moment.</span>
        }
        <button type="button" class="follow" [attr.aria-pressed]="vm.follow()" (click)="vm.toggleFollow()"
          hlmTooltip="Ouvre en aperçu chaque fichier que Claude touche, sans quitter un fichier en cours d’édition" [showDelay]="400">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /></svg>Suivre
        </button>
      </div>
    }
    @if (!compact()) {
      <h3 class="sub">Fichiers touchés<span class="n mono">{{ vm.touched().length }}</span></h3>
      @if (vm.touched().length) { <app-files-touched class="list" /> }
      @else { <p class="empty">Claude n’a encore lu ni modifié aucun fichier dans cette session.</p> }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    :host(.full) { flex: 1; }
    .line { flex: none; display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 6px 0 4px; }
    :host(.compact) .line { border-bottom: 1px solid var(--line); }
    .ic { flex: none; width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .here {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 6px; border: 0; border-radius: 4px;
      background: none; color: var(--text-2); font-size: 13px; text-align: left; cursor: pointer; transition: background-color var(--dur-fast) var(--ease);
    }
    .here:hover { background: var(--hover); color: var(--text); }
    .here.on .name { color: var(--text); }
    .pulse { flex: none; width: 7px; height: 7px; margin-right: 2px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px var(--brand-bg); animation: pulse 1.6s var(--ease) infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 5px var(--brand-bg); background: var(--brand-hover); } }
    .verb { flex: none; font-size: 12px; color: var(--brand); }
    .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .idle { flex: 1; min-width: 0; padding: 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--faint); }
    .follow {
      flex: none; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px;
      background: none; color: var(--faint); font: inherit; font-size: 12px; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    .follow:hover { background: var(--hover); color: var(--text); }
    .follow[aria-pressed='true'] { border-color: var(--brand); background: var(--brand-bg); color: var(--text); }
    .follow:focus-visible, .here:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .sub { flex: none; display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; padding: 0 12px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .n { font-size: 11px; font-weight: 400; color: var(--faint); }
    .list { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
    .empty { margin: 0; padding: 4px 12px; font-size: 12px; color: var(--faint); }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  `,
  host: { '[class.compact]': 'compact()', '[class.full]': '!compact()' },
})
export class FilesClaudeHereComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly name = base;
  /** En tête de la vue Projet : une ligne, seulement quand Claude travaille. */
  readonly compact = input(false);
}
