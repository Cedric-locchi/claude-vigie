import { Component, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { FilesTabsComponent } from '../tabs/files-tabs.component';
import { SessionFilesVm } from '../session-files.vm';

/**
 * En-tête de l'éditeur : bande des onglets (32 px) avec les actions compactes à droite, puis, pour un fichier modifié
 * par Claude, une bannière d'information fine comme les bannières d'éditeur de JetBrains. Le fil d'Ariane est dans la barre d'état.
 * Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-editor-header',
  imports: [HlmButton, HlmTooltip, FilesTabsComponent],
  template: `
    @let a = vm.active();
    <div class="band">
      <app-files-tabs />
      @if (a) {
        <div class="actions">
          @if (vm.editing()) {
            <button hlmBtn variant="ghost" size="sm" class="act" (click)="vm.cancelEdit()">Annuler</button>
            <button hlmBtn size="sm" class="act" [disabled]="!vm.idle() || vm.saving()" [attr.aria-keyshortcuts]="vm.keys.aria + '+S'" (click)="vm.save()" [hlmTooltip]="vm.idle() ? 'Écrit le fichier sur le disque (' + vm.keys.mod + 'S)' : BUSY">{{ vm.saving() ? 'Enregistrement…' : 'Enregistrer' }}</button>
          } @else if (vm.idle() && a.body) {
            <button hlmBtn variant="ghost" size="sm" class="act" [disabled]="vm.loadingFile()" (click)="vm.startEdit()" hlmTooltip="Modifier ce fichier à la main" [showDelay]="300">{{ vm.loadingFile() ? 'Lecture…' : 'Éditer' }}</button>
          }
          @if (!vm.editing() && a.body && vm.isMd()) {
            <button type="button" class="ib" aria-label="Aperçu mis en forme" [attr.aria-pressed]="!vm.showSource()" (click)="vm.showSource.set(!vm.showSource())" hlmTooltip="Aperçu mis en forme" [showDelay]="300">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="EYE" /></svg>
            </button>
          }
          @if (!vm.markdown()) {
            <button type="button" class="ib" aria-label="Retour à la ligne" [attr.aria-pressed]="vm.wrap()" (click)="vm.toggleWrap()" hlmTooltip="Retour à la ligne (sans numéros de ligne)" [showDelay]="300">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="WRAP" /></svg>
            </button>
          }
        </div>
      }
    </div>
    @if (vm.activeTouch()?.editTurn; as turn) {
      <div class="banner" role="note">
        <svg class="info" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" /></svg>
        <span class="txt">Modifié par Claude au tour <span class="mono">{{ turn }}</span></span>
        @if (vm.canShowHistory()) { <button type="button" class="link" (click)="vm.showInHistory(vm.activeTouch()!)">Voir dans l’historique</button> }
      </div>
    }
  `,
  styles: `
    :host { flex: none; display: flex; flex-direction: column; }
    .band { display: flex; align-items: stretch; gap: 8px; height: 32px; padding-right: 6px; box-shadow: inset 0 -1px 0 var(--line); }
    app-files-tabs { flex: 1 1 auto; }
    .actions { flex: none; display: flex; align-items: center; gap: 2px; }
    .act { height: 24px; padding: 0 8px; font-size: 12px; }
    .ib {
      display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 4px; background: none; color: var(--faint); cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .ib:hover { background: var(--hover); color: var(--text); }
    .ib[aria-pressed='true'] { background: var(--brand-bg); color: var(--text); }
    .ib:focus-visible, .link:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .ib svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .banner { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; background: var(--surface-2); box-shadow: inset 0 -1px 0 var(--line); font-size: 12px; color: var(--text-2); }
    .info { flex: none; width: 14px; height: 14px; fill: none; stroke: var(--text-muted); stroke-width: 1.8; stroke-linecap: round; }
    .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .link { flex: none; padding: 0 2px; border: 0; border-radius: 2px; background: none; color: var(--brand); font: inherit; cursor: pointer; }
    .link:hover { text-decoration: underline; }
  `,
})
export class FilesEditorHeaderComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly BUSY = 'Claude travaille : édition bloquée';
  protected readonly EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
  protected readonly WRAP = 'M3 6h18M3 12h15a3 3 0 0 1 0 6h-5m2-2-2 2 2 2M3 18h6';
}
