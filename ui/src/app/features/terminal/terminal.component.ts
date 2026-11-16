import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, viewChild } from '@angular/core';
import { TerminalVm } from './terminal.vm';

@Component({
  selector: 'app-terminal',
  providers: [TerminalVm],
  template: `
    <!-- Marge sur un cadre à part : FitAddon mesure le parent de xterm padding compris (border-box)
         et ne retire que le padding de xterm lui-même ; un parent rembourré ferait déborder le terminal. -->
    <div class="frame" (click)="vm.focus()"><div #host class="host"></div></div>
    @if (vm.status() === 'closed') { <p class="closed small">Connexion au terminal perdue — reconnexion…</p> }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .frame { flex: 1; min-height: 0; display: flex; padding: 12px 14px; background: var(--bg-deep); }
    .host { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
    .closed { padding: 6px 14px; color: var(--err); }
  `,
})
export class TerminalComponent {
  readonly terminalId = input.required<string>();
  readonly active = input(true);
  /** Incrémenté pour redonner le focus au terminal actif (« Aller au terminal »), même s'il l'était déjà. */
  readonly focusTick = input(0);
  protected readonly vm = inject(TerminalVm);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  constructor() {
    afterNextRender(() => {
      this.vm.attach(this.host().nativeElement, this.terminalId());
      if (this.active()) this.vm.focus();
    });
    // Synchronisation DOM uniquement : un onglet qui redevient visible doit reprendre sa taille et se redessiner.
    effect(() => {
      this.focusTick();
      if (!this.active()) return;
      requestAnimationFrame(() => { this.vm.fit(); this.vm.repaint(); this.vm.focus(); });
    });
    inject(DestroyRef).onDestroy(() => this.vm.dispose());
  }
}
