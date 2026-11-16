import { Component, ElementRef, Injector, afterNextRender, inject, viewChild } from '@angular/core';
import { Icon } from '../../../../core/icon.component';
import { SessionFilesVm } from '../session-files.vm';
import { FilesSearchVm } from './files-search.vm';

/**
 * Fenêtre d'outil Rechercher (⌘⇧F / Ctrl+Shift+F) : champ de recherche dans le contenu, résumé, résultats groupés par fichier.
 * « Respecter la casse » est dans l'en-tête de la fenêtre. Résultats en motif ARIA « tree », mêmes touches que l'arbre du projet ;
 * ↓ dans le champ y entre, Échap ou ↑ sur la première ligne rend la main au champ. Vue seule : la logique est dans `FilesSearchVm`.
 */
@Component({
  selector: 'app-files-search',
  imports: [Icon],
  template: `
    <div class="field">
      <svg appIcon="search" class="lens"></svg>
      <input #q class="q" type="search" placeholder="Chercher dans le contenu" aria-label="Texte à chercher dans les fichiers du projet"
        maxlength="200" autocomplete="off" spellcheck="false" [attr.aria-keyshortcuts]="files.keys.aria + '+Shift+F'"
        [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" (keydown)="fieldKey($event)" />
    </div>
    @if (vm.summary(); as s) { <p class="sum" [class.err]="s.err" role="status">{{ s.text }}</p> }
    @else { <p class="sum">Texte littéral, dans tous les fichiers du projet.</p> }
    @if (vm.truncated()) { <p class="sum" role="status">Résultats coupés à 2 000 lignes : affine la recherche</p> }
    <div #list class="results" role="tree" aria-label="Résultats dans le contenu" (keydown)="key($event)">
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
    .field { flex: none; position: relative; margin: 2px 8px 4px; }
    .lens { position: absolute; left: 8px; top: 7px; width: 14px; height: 14px; color: var(--faint); stroke-linecap: round; pointer-events: none; }
    .q {
      width: 100%; height: 28px; padding: 0 8px 0 28px; border: 1px solid var(--control); border-radius: 6px; background: var(--bg); color: var(--text);
      font: inherit; font-size: 13px; outline: none; transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .q::placeholder { color: var(--faint); }
    .q:focus-visible { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
    .sum { flex: none; margin: 0; padding: 2px 12px 4px; font-size: 12px; color: var(--faint); }
    .sum[role='status'] { color: var(--text-muted); }
    .sum.err { color: var(--err); }
    .results { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px 8px; scrollbar-width: thin; }
    .row {
      display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 4px; cursor: pointer; white-space: nowrap;
      color: var(--text-2); font-size: 13px; transition: background-color var(--dur-fast) var(--ease);
    }
    .row:hover { background: var(--hover); color: var(--text); }
    .row:active { background: var(--press); }
    .row:focus { background: var(--brand-bg); color: var(--text); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .ic { flex: none; width: 14px; height: 14px; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; color: var(--faint); transition: transform var(--dur-fast) var(--ease); }
    .ic.open { transform: rotate(90deg); }
    .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
    .dir { flex: 1 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--faint); }
    .n { flex: none; margin-left: auto; font-size: 11px; color: var(--faint); }
    .hit { padding-left: 28px; font-size: 12px; }
    .ln { flex: none; min-width: 3ch; font-size: 11px; text-align: right; color: var(--faint); }
    .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    mark { border-radius: 2px; background: var(--brand-bg); color: var(--text); box-shadow: inset 0 -1px 0 var(--brand); }
    @media (prefers-reduced-motion: reduce) { .ic { transition: none; } }
  `,
})
export class FilesSearchComponent {
  protected readonly vm = inject(FilesSearchVm);
  protected readonly files = inject(SessionFilesVm);
  private readonly injector = inject(Injector);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('q');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  /** ⌘⇧F, ou « Chercher dans le contenu » depuis ⌘P : focus dans le champ, saisie sélectionnée (après rendu : la vue vient peut-être d'apparaître). */
  focusField(): void {
    afterNextRender(() => { const el = this.input().nativeElement; el.focus(); el.select(); }, { injector: this.injector });
  }

  /** ↓ entre dans les résultats ; Échap vide le champ (champ vide : remonte, le tiroir se ferme). */
  protected fieldKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && this.vm.rows().length) { e.preventDefault(); this.focusRow(); }
    else if (e.key === 'Escape' && this.vm.query()) { e.preventDefault(); e.stopPropagation(); this.vm.query.set(''); }
  }

  protected key(e: KeyboardEvent): void {
    const first = this.vm.rows()[0]?.path === this.vm.focusRow();
    if (e.key === 'Escape' || (e.key === 'ArrowUp' && first)) {
      e.preventDefault();
      e.stopPropagation();
      this.input().nativeElement.focus();
      return;
    }
    if (!this.vm.key(e.key)) return;
    e.preventDefault();
    this.focusRow();
  }

  /** Après rendu : focus (et défilement) sur la ligne qui porte le tabindex. */
  focusRow(): void {
    afterNextRender(() => {
      const path = this.vm.focusRow();
      const el = [...this.list().nativeElement.querySelectorAll<HTMLElement>('[role=treeitem]')].find((r) => r.dataset['path'] === path);
      el?.focus();
      el?.scrollIntoView?.({ block: 'nearest' });
    }, { injector: this.injector });
  }
}
