import { Component, ElementRef, Injector, afterNextRender, inject, viewChild } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { Icon } from '../../../../core/icon.component';
import { FilesClaudeHereComponent } from '../claude-here/files-claude-here.component';
import { FileIconComponent } from '../../../../core/file-icon.component';
import { SessionFilesVm, base } from '../session-files.vm';

/**
 * Fenêtre d'outil Projet : « Claude ici » sur une ligne quand Claude travaille, puis l'arbre du projet façon JetBrains
 * (lignes de 24 px, icônes de type colorées (core/file-icon), guides d'indentation discrets, sélection arrondie en retrait).
 * Motif ARIA « tree » avec roving tabindex. Vue seule : la logique est dans `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-project',
  imports: [Icon, HlmTooltip, FilesClaudeHereComponent, FileIconComponent],
  template: `
    @let p = vm.project();
    @let a = vm.active();
    @let ch = vm.changes();
    <app-files-claude-here [compact]="true" />
    <div class="root">
      @if (vm.listError(); as e) { <span class="err" role="alert">{{ e }}</span> }
      @else if (!p) { <span class="faint">Lecture du projet…</span> }
      @else {
        <span class="root-name" [hlmTooltip]="p.root" [showDelay]="500">{{ name(p.root) }}</span>
        <span class="faint mono">{{ vm.files().length }}<span class="sr-only"> fichiers</span></span>
      }
    </div>
    @if (p?.truncated) { <p class="warn" role="status">Plus de 20 000 entrées : la liste est incomplète.</p> }
    <div #tree class="tree" role="tree" aria-label="Fichiers du projet" (keydown)="key($event)">
      @for (r of vm.rows(); track r.path) {
        @let tc = vm.touchedByPath().get(r.path);
        @let ed = vm.editedDirs().get(r.path);
        <div role="treeitem" class="row" [class.ignored]="r.kind === 'ignored'" [style.--depth]="r.depth" [attr.data-path]="r.path"
          [attr.tabindex]="r.path === vm.focusRow() ? 0 : -1" [attr.aria-level]="r.depth + 1"
          [attr.aria-expanded]="r.kind === 'dir' ? r.open : null" [attr.aria-selected]="r.kind === 'file' ? a?.path === r.path : null"
          [attr.aria-disabled]="r.kind === 'ignored' || null" (click)="vm.pick(r)" (dblclick)="r.kind === 'file' && vm.pin(r.path)">
          @if (r.kind === 'file') { <span class="chev" aria-hidden="true"></span><app-file-icon [name]="r.path" /> }
          @else { <svg appIcon="chevron" class="chev" [class.open]="r.open" [class.none]="r.kind === 'ignored'"></svg><app-file-icon [name]="r.path" [dir]="true" [open]="r.open" /> }
          <!-- ponytail: infobulle native (title) : des milliers de lignes, pas une directive de tooltip par ligne. -->
          <span class="name" [attr.title]="r.name">{{ r.name }}</span>
          @if (tc) {
            <span class="touch" [class.edit]="tc.edited" aria-hidden="true"></span><span class="sr-only">, {{ tc.edited ? 'modifié' : 'lu' }} par Claude</span>
          } @else if (ed) {
            <span class="touch-n mono" aria-hidden="true">{{ ed }}</span><span class="sr-only">, {{ ed }} fichier{{ ed > 1 ? 's' : '' }} modifié{{ ed > 1 ? 's' : '' }} par Claude</span>
          }
          @if (r.kind === 'ignored') { <span class="sr-only">, ignoré, contenu non listé</span> }
          @if (r.kind === 'file' && ch.files.get(r.path); as f) {
            @if (f.added) { <span class="add mono">+{{ f.added }}<span class="sr-only"> ligne{{ f.added > 1 ? 's' : '' }} ajoutée{{ f.added > 1 ? 's' : '' }}</span></span> }
            <span class="st mono" [attr.data-st]="f.status"><span aria-hidden="true">{{ vm.STATUS[f.status].label }}</span><span class="sr-only">, {{ vm.STATUS[f.status].hint }}</span></span>
          } @else if (r.kind === 'dir' && ch.dirs.has(r.path)) {
            <span class="dot" aria-hidden="true"></span><span class="sr-only">, contient des changements</span>
          }
        </div>
      } @empty {
        @if (p) { <p class="empty">Projet vide.</p> }
      }
    </div>
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .root { flex: none; display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 12px; font-size: 13px; }
    .root-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--text); }
    .faint { font-size: 12px; color: var(--faint); }
    .err { font-size: 12px; color: var(--err); }
    .warn { margin: 0 12px 4px; font-size: 12px; color: var(--text-muted); }
    .tree { flex: 1; min-height: 0; overflow: auto; padding: 0 0 8px; outline: none; scrollbar-width: thin; }
    .row {
      position: relative; display: flex; align-items: center; gap: 4px; height: 24px; margin: 0 4px; padding: 0 8px 0 calc(4px + var(--depth) * 16px);
      border-radius: 4px; cursor: pointer; color: var(--text-2); font-size: 13px; white-space: nowrap; transition: background-color var(--dur-fast) var(--ease);
    }
    /* Guides d'indentation : un filet très discret par niveau, aligné sur le chevron du dossier parent. */
    .row::before {
      content: ''; position: absolute; inset: 0 auto 0 11px; width: calc(var(--depth) * 16px); pointer-events: none;
      background: repeating-linear-gradient(to right, color-mix(in oklch, var(--line), transparent 45%) 0 1px, transparent 1px 16px);
    }
    .row:hover { background: var(--hover); color: var(--text); }
    .row:active { background: var(--press); }
    /* Sélection : grise quand l'arbre n'a pas le focus, bleue lavée quand il l'a (comme JetBrains). */
    .row[aria-selected='true'] { background: var(--hover); color: var(--text); }
    .tree:focus-within .row[aria-selected='true'] { background: var(--brand-bg); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .row.ignored { color: var(--faint); cursor: default; }
    .chev { flex: none; width: 14px; height: 14px; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; color: var(--faint); transition: transform var(--dur-fast) var(--ease); }
    .chev.open { transform: rotate(90deg); }
    .chev.none { visibility: hidden; }
    .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; margin-left: 2px; }
    .touch { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--read); }
    .touch.edit { background: var(--brand); }
    .touch-n { flex: none; font-size: 11px; color: var(--brand); }
    .st { flex: none; width: 1ch; font-size: 11px; font-weight: 600; text-align: center; color: var(--text-muted); }
    .st[data-st='A'], .st[data-st='?'] { color: var(--ok); }
    .st[data-st='D'] { color: var(--err); }
    .st[data-st='R'] { color: var(--text-2); }
    .add { flex: none; font-size: 11px; color: var(--ok); }
    .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
    .empty { margin: 0; padding: 8px 12px; font-size: 13px; color: var(--faint); }
    @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
  `,
})
export class FilesProjectComponent {
  protected readonly vm = inject(SessionFilesVm);
  private readonly injector = inject(Injector);
  protected readonly name = base;
  private readonly tree = viewChild.required<ElementRef<HTMLElement>>('tree');

  protected key(e: KeyboardEvent): void {
    if (!this.vm.treeKey(e.key)) return;
    e.preventDefault();
    this.focusRow();
  }

  /** Après rendu : focus (et défilement) sur la ligne qui porte le tabindex (clavier, fil d'Ariane, « Localiser »). */
  focusRow(): void {
    afterNextRender(() => {
      const path = this.vm.focusRow();
      const el = [...this.tree().nativeElement.querySelectorAll<HTMLElement>('[role=treeitem]')].find((r) => r.dataset['path'] === path);
      el?.focus();
      el?.scrollIntoView?.({ block: 'nearest' });
    }, { injector: this.injector });
  }
}
