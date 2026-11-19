import { Component, inject, input } from '@angular/core';
import { TaskLauncherComponent } from '@vigie/plugin-sdk';
import { NxVm } from './nx.vm';

/**
 * Onglet « Nx » : le lanceur du SDK, les cibles de tous les projets rangées par nature (lues par `nx graph`, lent).
 * « Lancer » ouvre un terminal qui lance `nx run projet:cible`.
 */
@Component({
  selector: 'vigie-plugin-nx',
  imports: [TaskLauncherComponent],
  providers: [NxVm],
  template: `
    <vigie-task-launcher heading="Nx" [source]="vm.source()" [themes]="vm.themes()" [loading]="vm.loading()"
                         [loadingText]="vm.loadingGraph() ? 'Lecture du graphe Nx… (jusqu’à une minute)' : 'Lecture de l’espace Nx…'"
                         [error]="vm.launchError() ?? (vm.telemetry() ? null : vm.error())" [launching]="vm.launching()" [storageKey]="vm.storageKey()"
                         searchLabel="Rechercher une cible ou un projet" (run)="vm.run($event)" (refresh)="vm.refresh()">
      @if (vm.telemetry()) {
        <p note>Télémétrie Nx activée dans <span class="mono">nx.json</span> (<span class="mono">"analytics": true</span>) : Vigie ne lance pas <span class="mono">nx graph</span>, qui enverrait des données. Désactive-la dans <span class="mono">nx.json</span> puis rafraîchis pour voir les projets.</p>
      }
      @if (vm.graph()?.truncated) { <p note>Liste incomplète : espace Nx trop gros, seuls les premiers projets sont affichés.</p> }
      @if (vm.graph() && !vm.telemetry()) { <p empty class="small faint">Aucune cible dans cet espace Nx.</p> }
    </vigie-task-launcher>
  `,
  styles: `:host { flex: 1; min-height: 0; display: flex; flex-direction: column; }`,
})
export default class NxTabComponent {
  protected readonly vm = inject(NxVm);
  /** Fourni par l'onglet hôte (décision 037) ; la session vient aussi de `PluginHost`. */
  readonly sessionId = input<string>();
}
