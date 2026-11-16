import { Component, ElementRef, Injector, afterNextRender, inject, viewChild } from '@angular/core';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { Icon } from '../../../../core/icon.component';
import { FilesSearchVm } from './files-search.vm';
import { SessionFilesVm } from '../session-files.vm';

/**
 * Vue Rechercher de l'onglet Fichiers (⌘⇧F / Ctrl+Shift+F) : champ, bascule « Aa », résumé, résultats groupés par fichier.
 * Les résultats suivent le motif ARIA « tree » de l'explorateur (mêmes touches). Vue seule : la logique est dans `FilesSearchVm`.
 */
@Component({
  selector: 'app-files-search',
  imports: [Icon, HlmInput, HlmTooltip],
  template: `
    <div class="head"><h2 class="title">Rechercher</h2></div>
    <div class="field">
      <input #q hlmInput type="search" class="q" placeholder="Rechercher dans les fichiers" aria-label="Texte à chercher dans les fichiers du projet"
        maxlength="200" autocomplete="off" spellcheck="false" [attr.aria-keyshortcuts]="files.keys.aria + '+Shift+F'"
        [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" (keydown.arrowdown)="$event.preventDefault(); focusRow()" />
      <button type="button" class="aa" aria-label="Respecter la casse" [attr.aria-pressed]="vm.matchCase()" (click)="vm.toggleCase()"
        hlmTooltip="Respecter la casse" [showDelay]="300">Aa</button>
    </div>
    @if (vm.summary(); as s) { <p class="sum" [class.err]="s.err" role="status">{{ s.text }}</p> }
    @if (vm.truncated()) { <p class="sum" role="status">Résultats coupés à 2 000 lignes : affine la recherche</p> }
    <div #list class="results" role="tree" aria-label="Résultats de la recherche" (keydown)="key($event)">
      @for (r of vm.rows(); track r.path) {
        @if (r.parts; as p) {
          <div role="treeitem" class="row hit" aria-level="2" [attr.data-path]="r.path" [attr.tabindex]="r.path === vm.focusRow() ? 0 : -1" (click)="vm.pick(r)">
            <span class="ln mono"><span class="sr-only">Ligne </span>{{ r.match!.line }}</span>
            <span class="txt">{{ p.pre }}<mark>{{ p.hit }}</mark>{{ p.post }}</span>
          </div>
        } @else {
          <div role="treeitem" class="row file" aria-level="1" [attr.aria-expanded]="r.open" [attr.data-path]="r.path" [attr.tabindex]="r.path === vm.focusRow() ? 0 : -1"
            [attr.title]="r.path" (click)="vm.pick(r)">
            <svg appIcon="chevron" class="ic" [class.open]="r.open"></svg>
            <span class="name">{{ r.name }}</span>
            @if (r.dir) { <span class="dir">{{ r.dir }}</span> }
            <span class="n mono">{{ r.count }}<span class="sr-only"> résultat{{ r.count > 1 ? 's' : '' }}</span></span>
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .head { flex: none; display: flex; align-items: center; min-height: 40px; padding: 4px 12px 0; }
    .title { margin: 0; font-size: 12px; font-weight: 600; color: var(--text); }
    .field { flex: none; position: relative; margin: 0 8px 4px; }
    .q { width: 100%; height: 30px; padding-right: 36px; font-size: 12px; }
    .aa {
      position: absolute; top: 3px; right: 3px; width: 26px; height: 24px; border: 1px solid transparent; border-radius: 4px;
      background: none; color: var(--faint); font: 600 11px/1 var(--mono); cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .aa:hover { background: var(--hover); color: var(--text); }
    .aa[aria-pressed='true'] { background: var(--brand-bg); border-color: var(--brand); color: var(--text); }
    .aa:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
    .sum { flex: none; margin: 0; padding: 2px 12px 4px; font-size: 12px; color: var(--text-muted); }
    .sum.err { color: var(--err); }
    .results { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 8px; }
    .row {
      display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 6px; cursor: pointer; white-space: nowrap;
      color: var(--text-2); font-size: 12px; transition: background-color var(--dur-fast) var(--ease);
    }
    .row:hover { background: var(--hover); color: var(--text); }
    .row:active { background: var(--press); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .ic { flex: none; width: 14px; height: 14px; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--dur-fast) var(--ease); }
    .ic.open { transform: rotate(90deg); }
    .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
    .dir { flex: 1 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: var(--faint); }
    .n { flex: none; margin-left: auto; min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--surface-2); font-size: 11px; line-height: 16px; text-align: center; }
    .hit { padding-left: 28px; }
    .ln { flex: none; min-width: 3ch; font-size: 11px; text-align: right; color: var(--faint); }
    .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    mark { border-radius: 2px; background: var(--brand-bg); color: var(--text); box-shadow: inset 0 -1px 0 var(--brand); }
  `,
})
export class FilesSearchComponent {
  protected readonly vm = inject(FilesSearchVm);
  protected readonly files = inject(SessionFilesVm);
  private readonly injector = inject(Injector);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('q');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  /** Focus dans le champ, saisie sélectionnée (⌘⇧F). */
  focus(): void {
    const el = this.input().nativeElement;
    el.focus();
    el.select();
  }

  protected key(e: KeyboardEvent): void {
    if (!this.vm.key(e.key)) return;
    e.preventDefault();
    this.focusRow();
  }

  /** Après rendu : focus (et défilement) sur la ligne qui porte le tabindex. */
  protected focusRow(): void {
    afterNextRender(() => {
      const path = this.vm.focusRow();
      const el = [...this.list().nativeElement.querySelectorAll<HTMLElement>('[role=treeitem]')].find((r) => r.dataset['path'] === path);
      el?.focus();
      el?.scrollIntoView?.({ block: 'nearest' });
    }, { injector: this.injector });
  }
}
