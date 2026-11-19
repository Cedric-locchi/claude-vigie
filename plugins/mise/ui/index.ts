import { Component, inject, input } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { TaskLauncherComponent } from '@vigie/plugin-sdk';
import { MISE_MISSING, MiseVm } from './mise.vm';

/**
 * Onglet « Tâches mise » : le lanceur du SDK, un panneau par secteur (front, back…). « Lancer » ouvre un terminal qui
 * lance `mise run <tâche>` ; config non approuvée : `mise trust` dans un terminal.
 */
@Component({
  selector: 'vigie-plugin-mise',
  imports: [HlmButton, TaskLauncherComponent],
  providers: [MiseVm],
  template: `
    <vigie-task-launcher heading="Tâches mise" [themes]="vm.themes()" [loading]="vm.loading()" loadingText="Lecture des tâches mise…"
                         [error]="vm.error()" [launching]="vm.launching()" [storageKey]="vm.storageKey()"
                         (run)="vm.run($event)" (refresh)="vm.refresh()">
      @if (vm.missing()) { <p note>{{ missing }}</p> }
      @if (vm.notice(); as n) {
        <div note class="trust">
          <p class="mono">{{ n }}</p>
          @if (vm.untrusted()) {
            <button hlmBtn size="sm" [attr.aria-disabled]="vm.launching() !== null || null" (click)="vm.trust()">Approuver avec mise trust</button>
          }
        </div>
      }
      @if (!vm.missing() && !vm.notice()) {
        <p empty class="small faint">Aucune tâche mise dans ce projet. Déclare-les dans <span class="mono">mise.toml</span>, section <span class="mono">[tasks]</span>.</p>
      }
    </vigie-task-launcher>
  `,
  styles: `
    :host { display: block; }
    .trust { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .trust p { flex: 1 1 24ch; min-width: 0; margin: 0; white-space: pre-wrap; }
  `,
})
export default class MiseTabComponent {
  protected readonly vm = inject(MiseVm);
  protected readonly missing = MISE_MISSING;
  /** Fourni par l'onglet hôte (décision 037) ; la session vient aussi de `PluginHost`. */
  readonly sessionId = input<string>();
}
