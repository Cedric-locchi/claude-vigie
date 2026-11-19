import { Component, inject, input } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { XCODE_ACTIONS, XcodeVm } from './xcode.vm';

/**
 * Onglet « Xcode » : conteneur du projet, choix du scheme et du simulateur, actions (lancer, build, test, clean)
 * et scripts du projet. Chaque action ouvre un terminal que la page affiche (même flux que les tâches mise).
 */
@Component({
  selector: 'vigie-plugin-xcode',
  imports: [HlmBadge, HlmButton, HlmSelectImports],
  providers: [XcodeVm],
  template: `
    <div class="head">
      @if (vm.container(); as c) {
        <h2 class="mono">{{ c.name }}</h2>
        <span hlmBadge variant="outline">{{ vm.kindLabel() }}</span>
      }
      <span class="spacer"></span>
      <button hlmBtn variant="outline" size="sm" [disabled]="vm.loading()" (click)="vm.refresh()">{{ vm.loading() ? 'Lecture…' : 'Rafraîchir' }}</button>
      <button hlmBtn variant="outline" size="sm" [disabled]="vm.launching()" (click)="vm.openInXcode()">Ouvrir dans Xcode</button>
    </div>

    @if (vm.launchError(); as err) { <p class="small text-err" role="alert">{{ err }}</p> }
    @if (vm.loading()) { <p class="small muted" role="status">Lecture du projet Xcode…</p> }
    @if (vm.targetsError(); as err) { <p class="small text-err" role="alert">{{ err }}</p> }

    @if (vm.targets(); as t) {
      @if (t.available) {
        <div class="controls">
          <label class="field">
            <span class="small muted">Scheme</span>
            <hlm-select class="pick" [value]="vm.scheme()" (valueChange)="vm.pickScheme($any($event))">
              <hlm-select-trigger size="sm" class="w-full" buttonId="xcode-scheme" aria-label="Scheme"><hlm-select-value placeholder="Aucun scheme" /></hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (s of vm.schemes(); track s) { <hlm-select-item [value]="s">{{ s }}</hlm-select-item> }
              </hlm-select-content>
            </hlm-select>
          </label>
          <label class="field">
            <span class="small muted">Simulateur</span>
            <hlm-select class="pick" [value]="vm.udid()" (valueChange)="vm.pickSimulator($any($event))" [itemToString]="vm.simulatorLabel">
              <hlm-select-trigger size="sm" class="w-full" buttonId="xcode-sim" aria-label="Simulateur"><hlm-select-value placeholder="Aucun simulateur" /></hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal class="max-h-96">
                @for (g of vm.runtimes(); track g.runtime) {
                  <hlm-select-group>
                    <hlm-select-label>{{ g.runtime }}</hlm-select-label>
                    @for (s of g.sims; track s.udid) {
                      <hlm-select-item [value]="s.udid">{{ s.name }}@if (s.booted) { <span class="booted">démarré</span> }</hlm-select-item>
                    }
                  </hlm-select-group>
                }
              </hlm-select-content>
            </hlm-select>
          </label>
          <div class="actions" role="group" aria-label="Actions Xcode">
            @for (a of actions; track a.action; let first = $first) {
              <button hlmBtn size="sm" [variant]="first ? 'default' : 'outline'" [disabled]="!vm.canRun(a.action)" (click)="vm.run(a.action)">{{ a.label }}</button>
            }
          </div>
        </div>
        @if (!vm.schemes().length) { <p class="small faint">Aucun scheme dans ce projet.</p> }
      } @else {
        <div class="notice">
          <p class="title">Xcode indisponible sur cette machine</p>
          @if (t.error) { <p class="small mono err-msg">{{ t.error }}</p> }
          <p class="small muted">Installe Xcode puis sélectionne-le : <code class="mono">sudo xcode-select -s /Applications/Xcode.app</code></p>
        </div>
      }
    }

    <section class="scripts" aria-labelledby="xcode-scripts">
      <h3 id="xcode-scripts"><span>Scripts du projet</span><span class="count">{{ vm.scripts().length }}</span></h3>
      @if (vm.scripts().length) {
        <ul>
          @for (s of vm.scripts(); track s) {
            <li><button type="button" class="task mono" [disabled]="vm.launching()" (click)="vm.runScript(s)" [attr.aria-label]="'Lancer le script ' + s" [title]="'scripts/' + s">{{ s }}</button></li>
          }
        </ul>
      } @else {
        <p class="small faint">Aucun script dans scripts/.</p>
      }
    </section>
  `,
  styles: `
    /* Pas de défilement propre : l'onglet hôte défile. */
    :host { display: flex; flex-direction: column; gap: 14px; }
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
    .spacer { flex: 1; }
    .controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pick { width: 240px; max-width: 100%; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .booted { margin-left: 8px; font-size: 11px; color: var(--ok); }
    .notice { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
    .notice p { margin: 0; }
    .title { font-weight: 600; color: var(--text); }
    .err-msg { color: var(--text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; color: var(--text); }

    h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); font-size: 13px; font-weight: 600; color: var(--text); }
    .count { font-size: 11px; font-weight: 500; color: var(--faint); font-variant-numeric: tabular-nums; }
    ul { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .task {
      max-width: 100%; padding: 5px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface);
      color: var(--text); font-size: 12.5px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    .task:hover:not(:disabled) { background: var(--hover); border-color: var(--line-strong); }
    .task:active:not(:disabled) { background: var(--press); }
    .task:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
    .task:disabled { cursor: progress; color: var(--faint); }
    @media (prefers-reduced-motion: reduce) { .task { transition: none; } }
  `,
})
export default class XcodeTabComponent {
  protected readonly vm = inject(XcodeVm);
  protected readonly actions = XCODE_ACTIONS;
  /** Fourni par l'onglet hôte (décision 037) ; la session et son dossier viennent de `PluginHost`. */
  readonly sessionId = input<string>();
}
