import { Component, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { AttentionItemComponent } from '../attention-item/attention-item.component';
import { Icon } from '../../core/icon.component';
import { AttentionService } from '../../core/attention.service';

/**
 * Toasts dans l'app (coin bas droit, 3 au plus), quand Vigie a le focus et que la session n'est pas celle affichée.
 * Une attente reste jusqu'à ce qu'elle change ou qu'on la ferme (× ou Échap) ; une fin de tour se ferme seule.
 */
@Component({
  selector: 'app-toast-host',
  imports: [Icon, HlmButton, AttentionItemComponent],
  template: `
    @for (t of attention.toasts(); track t.id) {
      <div class="toast" [class.urgent]="t.kind === 'waiting'" [attr.role]="t.kind === 'waiting' ? 'alert' : 'status'" (keydown.escape)="attention.closeToast(t.id)">
        <app-attention-item [row]="t.row" />
        <button hlmBtn variant="ghost" size="icon-xs" class="close" aria-label="Fermer la notification" (click)="attention.closeToast(t.id)">
          <svg appIcon="close" width="14" height="14"></svg>
        </button>
      </div>
    }
  `,
  styles: `
    :host { position: fixed; right: 16px; bottom: 16px; z-index: 40; display: flex; flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 32px)); pointer-events: none; }
    .toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; padding: 12px 8px 12px 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--nav); box-shadow: var(--elev-2); animation: toast-in var(--dur) var(--ease); }
    .toast.urgent { border-color: var(--wait-line); box-shadow: inset 2px 0 0 var(--wait), var(--elev-2); }
    @keyframes toast-in { from { transform: translateY(8px); } }
    .close { flex: none; color: var(--faint); }
  `,
})
export class ToastHostComponent {
  protected readonly attention = inject(AttentionService);
}
