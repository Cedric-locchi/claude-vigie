import { Component, inject, input, output } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { HlmButton } from '@spartan-ng/helm/button';
import { PluginTabVm } from './plugin-tab.vm';

/** Onglet d'un plugin : le composant Angular du plugin, chargé à la demande (décision 037). */
@Component({
  selector: 'app-plugin-tab',
  imports: [NgComponentOutlet, HlmButton],
  providers: [PluginTabVm],
  template: `
    @if (vm.failed()) {
      <div class="fail" role="alert">
        <p class="small text-err">Impossible de charger l’interface de ce plugin.</p>
        <button hlmBtn variant="outline" size="sm" (click)="vm.retry()">Réessayer</button>
        <button hlmBtn variant="ghost" size="sm" (click)="vm.reloadPage()">Recharger la page</button>
      </div>
    } @else if (vm.component(); as cmp) {
      <ng-container *ngComponentOutlet="cmp; injector: vm.injector(); inputs: vm.inputs()" />
    } @else if (vm.missing()) {
      <p class="small muted">Ce plugin n’a pas d’interface dans cette version de Vigie.</p>
    } @else {
      <p class="small muted" role="status">Chargement…</p>
    }
  `,
  styles: `
    /* Mode fill (gabarit) : l'onglet prend la hauteur du corps ; le lanceur la remplit et ses panneaux défilent, un plugin
       sans hauteur propre (xcode) défile ici. Téléphone : seul le document défile. */
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
    @media (max-width: 720px) { :host { overflow: visible; } }
    p { margin: 0; }
    .fail { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  `,
})
export class PluginTabComponent {
  protected readonly vm = inject(PluginTabVm);
  readonly sessionId = input.required<string>();
  readonly cwd = input.required<string>();
  readonly pluginId = input.required<string>();
  /** Terminal ouvert par une action du plugin : la page l'affiche. */
  readonly opened = output<string>();
  /** Le plugin demande de relire les onglets (détection, badge). */
  readonly refresh = output<void>();

  constructor() {
    this.vm.connect({ id: this.sessionId, cwd: this.cwd, pid: this.pluginId, opened: (id) => this.opened.emit(id), refresh: () => this.refresh.emit() });
  }
}
