import { Component, inject, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { MiseTasks } from '../../../core/models';
import { Icon } from '../../../core/icon.component';
import { SessionMiseVm } from './session-mise.vm';

/**
 * Onglet « Tâches mise » : un tableau de lancement. Chaque secteur (front, back…) tient sa colonne de gauche ;
 * chaque tâche est une ligne qui dit ce qu'elle fait et ce qu'elle exécute. Un clic ouvre un terminal qui lance
 * `mise run <tâche>` (même flux qu'un nouveau shell) ; « Entrée » dans la recherche lance la première tâche visible.
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
                 [value]="vm.search()" (input)="vm.search.set($any($event.target).value)"
                 (keydown.enter)="vm.first() && vm.run(vm.first()!.name)" />
          <div hlmInputGroupAddon><svg appIcon="search" width="15" height="15"></svg></div>
        </div>
        @if (vm.search().trim() && vm.first(); as f) {
          <p class="hint small faint" aria-live="polite"><kbd data-slot="kbd">Entrée</kbd> lance <span class="mono">{{ f.name }}</span></p>
        }
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
      <div class="board">
        @for (s of vm.sectors(); track s.name) {
          <section class="sector" [attr.aria-labelledby]="'sector-' + s.name">
            <h3 [id]="'sector-' + s.name">{{ s.name }}</h3>
            <ul>
              @for (t of s.tasks; track t.name) {
                <li>
                  <button type="button" class="task" [disabled]="vm.launching()" (click)="vm.run(t.name)"
                          [attr.aria-label]="'Lancer ' + t.name" [title]="'mise run ' + t.name">
                    <span class="name mono">{{ t.short }}@for (a of t.aliases; track a) { <span class="alias">{{ a }}</span> }</span>
                    <span class="what">
                      @if (t.description) { <span class="desc">{{ t.description }}</span> }
                      @if (t.depends.length) { <span class="deps">après {{ t.depends.join(', ') }}</span> }
                    </span>
                    <span class="cmd mono">@if (t.command) { {{ t.command }}@if (t.extra) { <span class="more">+{{ t.extra }}</span> } }</span>
                    <span class="go" aria-hidden="true">Lancer</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="small muted">Aucune tâche ne contient « {{ vm.search().trim() }} ».</p>
        }
      </div>
    } @else if (!vm.error()) {
      <p class="small faint">Aucune tâche mise dans ce projet. Déclare-les dans <span class="mono">mise.toml</span>, section <span class="mono">[tasks]</span>.</p>
    }
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; container-type: inline-size; }
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .search { flex: 1 1 240px; max-width: 360px; }
    .hint { margin: 0; display: flex; align-items: center; gap: 6px; }
    .head > button { margin-left: auto; }
    .notice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text-muted); }
    .notice p { flex: 1 1 24ch; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .notice.untrusted { border-color: var(--line-strong); color: var(--text); }

    /* Tableau de lancement : le secteur à gauche, ses tâches en lignes alignées (subgrid) à droite. */
    .board { flex: 0 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
    .sector { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 0 16px; padding: 10px 0; border-top: 1px solid var(--line); }
    .sector:first-child { border-top: 0; padding-top: 0; }
    h3 { margin: 0; padding: 7px 0; font-size: 13px; font-weight: 600; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ul { display: grid; grid-template-columns: minmax(8ch, max-content) minmax(0, 1fr) minmax(0, 32ch) max-content; margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; }
    .task {
      grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: baseline; column-gap: 16px;
      padding: 7px 10px; margin: 0 -10px; border: 0; border-radius: 6px; background: transparent;
      color: var(--text); font: inherit; text-align: left; cursor: pointer;
    }
    .task > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name { font-size: 13px; font-weight: 500; }
    .alias { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--faint); }
    .what { display: flex; align-items: baseline; gap: 10px; font-size: 13px; }
    .desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); }
    .deps { flex: none; font-size: 12px; color: var(--faint); }
    /* --cmd : la couleur des commandes dans tout Vigie. C'est ce qui s'exécutera vraiment. */
    .cmd { font-size: 12px; color: var(--cmd); }
    .more { margin-left: 6px; color: var(--faint); }
    .go { font-size: 12px; font-weight: 600; color: var(--brand); opacity: 0; }
    .task:hover:not(:disabled), .task:focus-visible { background: var(--hover); }
    .task:hover:not(:disabled) .go, .task:focus-visible .go { opacity: 1; }
    .task:active:not(:disabled) { background: var(--press); }
    .task:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .task:disabled { cursor: progress; color: var(--faint); }
    .task:disabled .cmd, .task:disabled .desc { color: var(--faint); }

    /* Étroit : le secteur passe au-dessus, la commande sous la description, plus de « Lancer » (le survol n'existe pas au doigt). */
    @container (max-width: 640px) {
      .sector { grid-template-columns: minmax(0, 1fr); }
      ul { grid-template-columns: minmax(0, 1fr); }
      .task { grid-template-columns: minmax(0, 1fr); row-gap: 2px; }
      .go { display: none; }
    }
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
