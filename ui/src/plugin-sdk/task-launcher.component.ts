import { Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { TaskLauncherVm, isSearchShortcut, type LauncherTask, type TaskTheme } from './task-launcher.vm';

let seq = 0;

/**
 * Lanceur de tâches partagé par les plugins (mise, npm, nx) : barre d'outils collante (provenance, recherche, Rafraîchir),
 * puis un panneau repliable par thème, une ligne par tâche avec son bouton « Lancer ». Aucun défilement propre : c'est
 * l'onglet du plugin qui défile. Avertissements du plugin : éléments projetés avec l'attribut `note` ; état vide : `empty`.
 */
@Component({
  selector: 'vigie-task-launcher',
  imports: [HlmButton, HlmInputGroupImports, HlmKbd],
  providers: [TaskLauncherVm],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <h2 class="sr-only">{{ heading() }}</h2>
    <div class="bar">
      @if (source(); as s) { <p class="small muted">{{ s }}</p> }
      @if (vm.count()) {
        <div hlmInputGroup class="search">
          <input #search hlmInputGroupInput type="search" [attr.aria-label]="searchLabel()" [placeholder]="searchLabel() + '…'"
                 [value]="vm.search()" (input)="vm.search.set($any($event.target).value)" (keydown.enter)="vm.runFirst()" />
          <div hlmInputGroupAddon><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5" /></svg></div>
        </div>
      }
      <p class="enter small faint" aria-live="polite">@if (vm.search().trim() && vm.first(); as f) {<kbd hlmKbd>Entrée</kbd> lance <span class="mono">{{ f.task.name }}</span>&nbsp;· {{ f.task.scope || f.theme }}}</p>
      <button hlmBtn variant="outline" size="sm" class="refresh" [attr.aria-disabled]="loading() || null" (click)="loading() || refresh.emit()">{{ loading() ? 'Lecture…' : 'Rafraîchir' }}</button>
    </div>

    <div class="notes small" role="note"><ng-content select="[note]" /></div>
    @if (error(); as e) { <p class="msg small text-err" role="alert">{{ e }}</p> }
    @if (loading()) { <p class="msg small muted" role="status">{{ loadingText() }}</p> }

    @if (vm.count()) {
      <div class="themes">
        @for (th of vm.visible(); track th.id; let i = $index) {
          <section class="theme">
            <h3>
              <button type="button" class="toggle" [id]="uid + '-h' + i" [attr.aria-expanded]="th.open" [attr.aria-controls]="uid + '-l' + i" (click)="vm.toggle(th.id)">
                <svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                <span class="label">{{ th.label }}</span>
                <span class="n mono">{{ th.tasks.length }}<span class="sr-only"> tâche{{ th.tasks.length > 1 ? 's' : '' }}</span></span>
              </button>
            </h3>
            <ul [id]="uid + '-l' + i" [hidden]="!th.open" [attr.aria-labelledby]="uid + '-h' + i">
              @for (t of th.tasks; track t.id; let j = $index) {
                <li [class.busy]="vm.launching() === t.id">
                  <div class="text">
                    <p><span class="name mono">{{ t.name }}</span>@if (t.scope) {<span class="scope mono">{{ t.scope }}</span>}</p>
                    @if (t.disabledReason) {
                      <p class="sub why" [id]="uid + '-w' + i + '-' + j">{{ t.disabledReason }}</p>
                    } @else if (t.hint) {
                      <p class="sub" [title]="vm.title(t)">{{ t.hint }}</p>
                    } @else if (t.command) {
                      <p class="sub cmd mono" [title]="t.command">{{ t.command }}</p>
                    }
                  </div>
                  <button hlmBtn variant="ghost" size="sm" class="go" [attr.aria-label]="vm.label(t)"
                          [attr.aria-disabled]="!!t.disabledReason || vm.launching() !== null || null"
                          [attr.aria-describedby]="t.disabledReason ? uid + '-w' + i + '-' + j : null" (click)="vm.run(t)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M7 5v14l11-7z" /></svg>
                    <span class="go-t">{{ vm.launching() === t.id ? 'Ouverture…' : 'Lancer' }}</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="small muted">Aucune tâche ne contient « {{ vm.search().trim() }} ».</p>
        }
      </div>
    } @else if (!loading() && !error()) {
      <ng-content select="[empty]" />
    }
  `,
  styles: `
    :host { display: block; container: launcher / inline-size; }
    p { margin: 0; }
    /* Barre collante en haut du défilement de l'onglet, sur le fond de page ; sur téléphone, sous ce que la page fait coller (--sticky-top). */
    .bar { position: sticky; top: var(--sticky-top, 0px); z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding-bottom: 14px; background: var(--bg); }
    .bar > p { min-width: 0; overflow-wrap: anywhere; }
    .search { flex: 1 1 220px; max-width: 360px; min-width: 0; }
    .enter { display: flex; align-items: center; gap: 6px; }
    .enter:empty { display: none; }
    .refresh { margin-left: auto; }
    .refresh[aria-disabled='true'] { cursor: progress; color: var(--faint); }
    /* Avertissements : encadré neutre (l'ambre est réservé à « attend l'utilisateur »). */
    .notes { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface); color: var(--text); overflow-wrap: anywhere; }
    .notes:empty { display: none; }
    .msg { margin-bottom: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }

    .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); align-items: start; gap: 14px; }
    .theme { min-width: 0; border: 1px solid var(--edge); border-radius: 12px; box-shadow: var(--elev-1); background: var(--surface); overflow: hidden; }
    h3 { margin: 0; font: inherit; }
    .toggle {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; border: 0; background: transparent;
      color: var(--text); font: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease);
    }
    .toggle:hover { background: var(--hover); }
    .toggle:active { background: var(--press); }
    .toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; border-radius: 12px; }
    .chev { flex: none; color: var(--faint); transition: transform var(--dur-fast) var(--ease); }
    [aria-expanded='false'] .chev { transform: rotate(-90deg); }
    .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .n { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--faint); }

    ul { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
    li { display: flex; align-items: center; gap: 12px; padding: 7px 8px 7px 14px; }
    li + li { border-top: 1px solid var(--line); }
    /* Ligne lancée : barre d'état bleue à gauche, le temps d'ouvrir le terminal. */
    li.busy { box-shadow: inset 2px 0 0 var(--run); }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .text p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name { font-size: 13px; color: var(--text); }
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
    @media (pointer: coarse) { .go, .toggle { min-height: 44px; } .go { min-width: 44px; } }
    @media (prefers-reduced-motion: reduce) { .chev, .cmd, .toggle { transition: none; } }
  `,
})
export class TaskLauncherComponent {
  protected readonly vm = inject(TaskLauncherVm);
  protected readonly uid = `tl${++seq}`;
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  /** Nom du plugin : titre `h2` (masqué) de l'onglet. */
  readonly heading = input.required<string>();
  /** Provenance, ex. « npm · package-lock.json ». */
  readonly source = input<string | null>(null);
  readonly themes = input<readonly TaskTheme[]>([]);
  readonly loading = input(false);
  readonly loadingText = input('Lecture…');
  readonly error = input<string | null>(null);
  /** Id de la tâche en cours de lancement (un seul à la fois). */
  readonly launching = input<string | null>(null);
  /** Clé de mémorisation des thèmes repliés : plugin + dossier du projet. */
  readonly storageKey = input.required<string>();
  /** Thèmes repliés tant que l'utilisateur ne les a pas ouverts. */
  readonly collapsedByDefault = input<readonly string[]>([]);
  readonly searchLabel = input('Rechercher une tâche');
  readonly run = output<LauncherTask>();
  readonly refresh = output<void>();

  constructor() {
    this.vm.connect({ themes: this.themes, launching: this.launching, storageKey: this.storageKey, collapsedByDefault: this.collapsedByDefault, run: (t) => this.run.emit(t) });
  }

  protected onKey(e: KeyboardEvent): void {
    const el = this.searchInput()?.nativeElement;
    if (el && isSearchShortcut(e)) { e.preventDefault(); el.focus(); }
  }
}
