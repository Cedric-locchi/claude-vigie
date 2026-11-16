import { Component, inject, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { MiseTasks } from '../../core/models';
import { Icon } from '../../core/icon.component';
import { SessionMiseVm } from './session-mise.vm';

/**
 * Onglet « Tâches mise » : les tâches du projet rangées par secteur (front, back…), seulement leur nom.
 * Un clic ouvre un terminal qui lance `mise run <tâche>` et l'affiche (même flux qu'un nouveau shell).
 */
@Component({
  selector: 'app-session-mise',
  imports: [Icon, HlmButton, HlmInputGroupImports],
  providers: [SessionMiseVm],
  template: `
    <div class="head">
      @if (vm.tasks().length) {
        <div hlmInputGroup class="search">
          <input hlmInputGroupInput type="search" aria-label="Rechercher une tâche" placeholder="Rechercher une tâche…"
                 [value]="vm.search()" (input)="vm.search.set($any($event.target).value)" />
          <div hlmInputGroupAddon><svg appIcon="search" width="15" height="15"></svg></div>
        </div>
      }
      <button hlmBtn variant="outline" size="sm" [disabled]="loading()" (click)="refresh.emit()">{{ loading() ? 'Lecture…' : 'Rafraîchir' }}</button>
    </div>

    @if (vm.error(); as err) {
      <div class="notice small" [class.untrusted]="vm.untrusted()">
        <p class="mono">{{ err }}</p>
        @if (vm.untrusted()) {
          <button hlmBtn size="sm" [disabled]="vm.launching()" (click)="vm.trust()">Approuver avec mise trust</button>
        }
      </div>
    }
    @if (vm.launchError(); as err) { <p class="small text-err" role="alert">{{ err }}</p> }

    @if (vm.tasks().length) {
      <div class="sectors">
        @for (s of vm.sectors(); track s.name) {
          <section class="sector" [attr.aria-labelledby]="'sector-' + s.name">
            <h3 [id]="'sector-' + s.name"><span>{{ s.name }}</span><span class="count">{{ s.tasks.length }}</span></h3>
            <ul>
              @for (t of s.tasks; track t.name) {
                <li>
                  <button type="button" class="task mono" [disabled]="vm.launching()" (click)="vm.run(t.name)"
                          [attr.aria-label]="'Lancer ' + t.name" [title]="'mise run ' + t.name">{{ t.short }}</button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="small muted">Aucune tâche ne contient « {{ vm.search().trim() }} ».</p>
        }
      </div>
    } @else if (!vm.error()) {
      <p class="small faint">Aucune tâche mise dans ce projet.</p>
    }
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
    .head { display: flex; align-items: center; gap: 8px 12px; }
    .search { flex: 1 1 auto; max-width: 360px; }
    .head > button { margin-left: auto; }
    .notice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text-muted); }
    .notice p { flex: 1 1 24ch; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .notice.untrusted { border-color: var(--line-strong); color: var(--text); }

    /* Secteurs en colonnes qui se replient : chacun est une rangée de touches à lancer. */
    .sectors { flex: 0 1 auto; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px 24px; align-content: start; }
    .sector { min-width: 0; }
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
export class SessionMiseComponent {
  protected readonly vm = inject(SessionMiseVm);
  readonly sessionId = input.required<string>();
  /** Réponse de mise, chargée par la page (c'est elle qui décide si l'onglet existe). */
  readonly mise = input<MiseTasks | null>(null);
  readonly loading = input(false);
  /** Terminal ouvert (tâche ou `mise trust`) : la page l'affiche. */
  readonly opened = output<string>();
  readonly refresh = output<void>();

  constructor() {
    this.vm.connect(this.sessionId, this.mise, (id) => this.opened.emit(id));
  }
}
