import { Component, inject, linkedSignal } from '@angular/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { ConfirmRequest, ConfirmService } from '../../core/confirm.service';

/** Boîte de confirmation unique de l'app, pilotée par ConfirmService. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [HlmAlertDialogImports],
  template: `
    <hlm-alert-dialog [state]="confirm.pending() ? 'open' : 'closed'" (stateChanged)="$event === 'closed' && confirm.answer(false)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal>
        @if (shown(); as req) {
          <hlm-alert-dialog-header>
            <h2 hlmAlertDialogTitle>{{ req.title }}</h2>
            <p hlmAlertDialogDescription>{{ req.message }}</p>
          </hlm-alert-dialog-header>
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel>Annuler</button>
            <button hlmAlertDialogAction [variant]="req.danger ? 'destructive' : 'default'" (click)="confirm.answer(true)">{{ req.action }}</button>
          </hlm-alert-dialog-footer>
        }
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
  /** Garde la dernière question affichée pendant l'animation de fermeture. */
  protected readonly shown = linkedSignal<ConfirmRequest | null, ConfirmRequest | null>({
    source: this.confirm.pending,
    computation: (pending, previous) => pending ?? previous?.value ?? null,
  });
}
