import { Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { TaskLauncherVm, isSearchShortcut, type LauncherTask, type TaskTheme } from './task-launcher.vm';

let seq = 0;

/**
 * Lanceur de tâches partagé par les plugins (mise, npm, nx), calqué sur l'onglet Config : une ligne d'en-tête (titre,
 * provenance, recherche, Rafraîchir), puis deux panneaux qui défilent chacun : les thèmes à gauche, les tâches du thème
 * choisi à droite, une ligne par tâche avec son bouton « Lancer ». Avertissements du plugin : éléments projetés avec
 * l'attribut `note` ; état vide : `empty`.
 */
@Component({
  selector: 'vigie-task-launcher',
  imports: [HlmButton, HlmInputGroupImports, HlmKbd],
  providers: [TaskLauncherVm],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <div class="head">
      <div class="title">
        <h2>{{ heading() }}</h2>
        @if (source(); as s) { <span class="where mono small faint" [title]="s">{{ s }}</span> }
      </div>
      <div class="actions">
        @if (vm.count()) {
          <div hlmInputGroup class="search">
            <input #search hlmInputGroupInput type="search" [attr.aria-label]="searchLabel()" [placeholder]="searchLabel() + '…'"
                   [value]="vm.search()" (input)="vm.search.set($any($event.target).value)" (keydown.enter)="vm.runFirst()" />
            <div hlmInputGroupAddon><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5" /></svg></div>
          </div>
        }
        <button hlmBtn variant="ghost" size="sm" class="refresh" [attr.aria-disabled]="loading() || null" (click)="loading() || refresh.emit()">{{ loading() ? 'Lecture…' : 'Rafraîchir' }}</button>
      </div>
    </div>

    <div class="notes small" role="note"><ng-content select="[note]" /></div>
    @if (error(); as e) { <p class="msg small text-err" role="alert">{{ e }}</p> }
    @if (loading()) { <p class="msg small muted" role="status">{{ loadingText() }}</p> }

    @if (vm.count()) {
      <div class="body">
        <nav class="nav" aria-label="Thèmes">
          @for (th of vm.visible(); track th.id) {
            <button type="button" class="nav-item" [attr.aria-current]="vm.current()?.id === th.id ? 'page' : null" (click)="vm.select(th.id)">
              <span class="label">{{ th.label }}</span>
              <span class="count">{{ th.tasks.length }}<span class="sr-only"> tâche{{ th.tasks.length > 1 ? 's' : '' }}</span></span>
            </button>
          }
        </nav>

        <section class="pane" [attr.aria-label]="vm.current()?.label ?? 'Recherche'">
          @if (vm.current(); as cur) {
            <header class="pane-head">
              <h3>{{ cur.label }}</h3>
              <p class="enter small faint" aria-live="polite">@if (vm.search().trim() && vm.first(); as f) {<kbd hlmKbd>Entrée</kbd> lance <span class="mono">{{ f.task.name }}</span>}</p>
            </header>
            <ul>
              @for (t of cur.tasks; track t.id; let j = $index) {
                <!-- Toute la ligne lance (souris) ; le bouton reste la cible clavier et lecteur d'écran, son clic remonte ici. -->
                <li [class.busy]="vm.launching() === t.id" [class.off]="!!t.disabledReason" (click)="vm.run(t)">
                  <div class="text">
                    <p><span class="name mono">{{ t.name }}</span>@if (t.scope) {<span class="scope mono">{{ t.scope }}</span>}</p>
                    @if (t.disabledReason) {
                      <p class="sub why" [id]="uid + '-w' + j">{{ t.disabledReason }}</p>
                    } @else if (t.hint) {
                      <p class="sub" [title]="vm.title(t)">{{ t.hint }}</p>
                    } @else if (t.command) {
                      <p class="sub cmd mono" [title]="t.command">{{ t.command }}</p>
                    }
                  </div>
                  <button hlmBtn variant="ghost" size="sm" class="go" [attr.aria-label]="vm.label(t)"
                          [attr.aria-disabled]="!!t.disabledReason || vm.launching() !== null || null"
                          [attr.aria-describedby]="t.disabledReason ? uid + '-w' + j : null">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M7 5v14l11-7z" /></svg>
                    <span class="go-t">{{ vm.launching() === t.id ? 'Ouverture…' : 'Lancer' }}</span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">Aucune tâche ne contient « {{ vm.search().trim() }} ».</p>
          }
        </section>
      </div>
    } @else if (!loading() && !error()) {
      <ng-content select="[empty]" />
    }
  `,
  // ponytail: navigation et panneau recopiés de l'onglet Config (le SDK n'importe pas ui/src/app) ; styles partagés si un 3e écran les reprend.
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; container: launcher / inline-size; }
    p { margin: 0; }
    .head { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    h2 { flex: none; margin: 0; font-size: 15px; font-weight: 600; }
    .where { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { flex: 1 1 260px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
    .search { flex: 1 1 220px; max-width: 320px; min-width: 0; }
    .refresh[aria-disabled='true'] { cursor: progress; color: var(--faint); }
    /* Avertissements : encadré neutre (l'ambre est réservé à « attend l'utilisateur »). */
    .notes { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface); color: var(--text); overflow-wrap: anywhere; }
    .notes:empty { display: none; }
    .msg { flex: none; white-space: pre-wrap; overflow-wrap: anywhere; }

    /* Deux panneaux séparés sur le fond pointillé, comme Config : navigation, contenu ; chacun défile seul. */
    .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 10px; }
    .nav, .pane { border: 1px solid var(--edge); border-radius: 12px; box-shadow: var(--elev-1); background: var(--surface); }
    .nav { display: flex; flex-direction: column; gap: 2px; padding: 8px; overflow-y: auto; }
    .nav-item {
      display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
      color: var(--text-2); font: inherit; font-size: 13px; text-align: start;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .nav-item:hover { background: var(--hover); color: var(--text); }
    .nav-item:active { background: var(--press); }
    .nav-item[aria-current='page'] { background: var(--brand-bg); color: var(--text); font-weight: 500; box-shadow: inset 2px 0 0 var(--brand); }
    .nav-item:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .label { margin-inline-end: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { min-width: 3ch; font-family: var(--mono); font-size: 11px; color: var(--faint); font-weight: 400; text-align: end; }

    .pane { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px 24px; display: flex; flex-direction: column; gap: 12px; }
    .pane-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; }
    h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .enter { display: flex; align-items: center; gap: 6px; }
    .enter:empty { display: none; }
    .empty { padding: 8px 0; font-size: 13px; color: var(--faint); }

    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
    li + li { border-top: 1px solid var(--line); }
    li:not(.off) { cursor: pointer; }
    li:not(.off):hover .name { color: var(--brand); }
    /* Ligne lancée : barre d'état bleue à gauche, le temps d'ouvrir le terminal. */
    li.busy { box-shadow: inset 2px 0 0 var(--run); padding-inline-start: 10px; }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .text p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name { font-size: 13px; font-weight: 500; color: var(--text); }
    .scope { margin-left: 8px; font-size: 11px; color: var(--faint); }
    .sub { font-size: 12px; color: var(--text-muted); }
    .why { color: var(--faint); }
    /* Commande en neutre mono ; la principale seulement sur la ligne visée (décision 042) : pas de mur de couleur. */
    .cmd { color: var(--text-2); transition: color var(--dur-fast) var(--ease); }
    li:is(:hover, :focus-within) .cmd { color: var(--brand); }
    .go { flex: none; color: var(--text-muted); }
    .go:hover { color: var(--text); }
    .go[aria-disabled='true'] { color: var(--faint); cursor: not-allowed; background: transparent; }
    li.busy .go { cursor: progress; color: var(--text); }

    @container launcher (max-width: 640px) { .go-t { display: none; } }
    @media (max-width: 820px) {
      .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .nav { flex-direction: row; overflow-x: auto; }
      .nav-item { flex: none; }
      .pane { padding: 14px; }
    }
    /* Téléphone : le document défile seul, le contenu s'allonge sous la navigation (qui défile sur le côté). */
    @media (max-width: 720px) { .pane { overflow: visible; } }
    @media (pointer: coarse) { .go, .nav-item { min-height: 44px; } .go { min-width: 44px; } }
    @media (prefers-reduced-motion: reduce) { .cmd, .nav-item { transition: none; } }
  `,
})
export class TaskLauncherComponent {
  protected readonly vm = inject(TaskLauncherVm);
  protected readonly uid = `tl${++seq}`;
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  /** Nom du plugin : titre `h2` de l'onglet. */
  readonly heading = input.required<string>();
  /** Provenance, ex. « npm · package-lock.json ». */
  readonly source = input<string | null>(null);
  readonly themes = input<readonly TaskTheme[]>([]);
  readonly loading = input(false);
  readonly loadingText = input('Lecture…');
  readonly error = input<string | null>(null);
  /** Id de la tâche en cours de lancement (un seul à la fois). */
  readonly launching = input<string | null>(null);
  /** Clé de mémorisation du thème choisi : plugin + dossier du projet. */
  readonly storageKey = input.required<string>();
  readonly searchLabel = input('Rechercher une tâche');
  readonly run = output<LauncherTask>();
  readonly refresh = output<void>();

  constructor() {
    this.vm.connect({ themes: this.themes, launching: this.launching, storageKey: this.storageKey, run: (t) => this.run.emit(t) });
  }

  protected onKey(e: KeyboardEvent): void {
    const el = this.searchInput()?.nativeElement;
    if (el && isSearchShortcut(e)) { e.preventDefault(); el.focus(); }
  }
}
