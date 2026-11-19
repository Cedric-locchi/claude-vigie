import { Component, inject, input } from '@angular/core';
import { TaskLauncherComponent } from '@vigie/plugin-sdk';
import { NpmVm } from './npm.vm';

/**
 * Onglet « Scripts npm » : le lanceur du SDK, les scripts de la racine et des workspaces rangés par nature. « Lancer »
 * ouvre un terminal qui lance le script avec le gestionnaire du dépôt. Les crochets (pre/post, prepare…) sont rangés dans « Cycle de vie ».
 */
@Component({
  selector: 'vigie-plugin-npm',
  imports: [TaskLauncherComponent],
  providers: [NpmVm],
  template: `
    <vigie-task-launcher heading="Scripts npm" [source]="vm.manager()" [themes]="vm.themes()" [loading]="vm.loading()" loadingText="Lecture du package.json…"
                         [error]="vm.error()" [launching]="vm.launching()" [storageKey]="vm.storageKey()"
                         searchLabel="Rechercher un script" (run)="vm.run($event)" (refresh)="vm.refresh()">
      @if (vm.project()?.warning; as w) { <p note>{{ w }}</p> }
      @if (vm.project()?.truncated) { <p note>Liste incomplète : trop de workspaces ou de scripts, seuls les premiers sont affichés.</p> }
      <p empty class="small faint">Aucun script dans ce projet. Déclare-les dans <span class="mono">package.json</span>, champ <span class="mono">scripts</span>.</p>
    </vigie-task-launcher>
  `,
  styles: `:host { flex: 1; min-height: 0; display: flex; flex-direction: column; }`,
})
export default class NpmTabComponent {
  protected readonly vm = inject(NpmVm);
  /** Fourni par l'onglet hôte (décision 037) ; la session vient aussi de `PluginHost`. */
  readonly sessionId = input<string>();
}
