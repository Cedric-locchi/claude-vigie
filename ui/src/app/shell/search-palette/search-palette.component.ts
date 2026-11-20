import { Component, ElementRef, Injector, afterNextRender, inject, output, viewChild } from '@angular/core';
import { Icon } from '../../core/icon.component';
import { SearchPaletteVm } from './search-palette.vm';

/**
 * Palette de recherche dans les sessions (⌘F / Ctrl+F, entrée « Rechercher » de la barre latérale ; décision 049) : <dialog> modal
 * centré en haut de l'écran, comme « Aller au fichier » (classes `.palette*` de styles.css) ; combobox + listbox, une option par
 * session avec ses extraits. Créée à l'ouverture (la coque la monte sous @if), elle émet `closed` une fois, quand le dialogue se ferme.
 * Vue seule : la logique est dans `SearchPaletteVm`.
 */
@Component({
  selector: 'app-search-palette',
  imports: [Icon],
  providers: [SearchPaletteVm],
  template: `
    @let rows = vm.rows();
    <dialog #d class="palette" aria-label="Rechercher dans les sessions" (close)="done()" (click)="$event.target === d && close()">
      <div class="palette-field">
        <svg appIcon="search" class="palette-lens"></svg>
        <input #q class="palette-q" type="text" role="combobox" [attr.aria-expanded]="rows.length > 0" aria-controls="palette-list" aria-autocomplete="list"
          [attr.aria-activedescendant]="rows.length ? 'palette-opt-' + vm.index() : null" placeholder="Rechercher dans les sessions" aria-label="Rechercher dans les sessions"
          maxlength="200" autocomplete="off" spellcheck="false" [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" (keydown)="key($event)" />
      </div>
      @let s = vm.summary();
      <p class="sum" [class.err]="s?.err" role="status">{{ s?.text ?? 'Titre et journal de toutes les sessions présentes dans Vigie.' }}</p>
      @if (vm.truncated()) { <p class="sum">Résultats incomplets : affine la recherche.</p> }
      <ul id="palette-list" class="palette-list" role="listbox" aria-label="Sessions trouvées">
        @for (r of rows; track r.id; let i = $index) {
          <li role="option" class="palette-opt" [id]="'palette-opt-' + i" [attr.aria-selected]="i === vm.index()" (click)="pick(i)" (mousemove)="vm.index.set(i)">
            <div class="head">
              <span [class]="'dot dot-' + r.state" aria-hidden="true"></span><span class="sr-only">{{ r.stateLabel }} : </span>
              <span class="title">{{ r.title }}</span><span class="project">{{ r.project }}</span><span class="n mono">{{ r.found }}</span>
            </div>
            @for (h of r.hits; track h.id) {
              <div class="hit"><span class="kind">{{ h.kind }}</span><time class="mono">{{ h.time }}</time><span class="txt">{{ h.parts.pre }}@if (h.parts.hit) {<mark>{{ h.parts.hit }}</mark>}{{ h.parts.post }}</span></div>
            }
          </li>
        }
      </ul>
    </dialog>
  `,
  styles: `
    .sum { flex: none; margin: 0; padding: 6px 14px; font-size: 12px; color: var(--text-muted); }
    .sum.err { color: var(--err); }
    .palette-opt { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; }
    .head { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; white-space: nowrap; }
    .title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 500; color: var(--text); }
    .project { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--faint); }
    .n { flex: none; font-size: 11px; color: var(--faint); }
    .hit { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding-left: 16px; font-size: 12px; white-space: nowrap; }
    .kind { flex: none; color: var(--text-muted); }
    time { flex: none; font-size: 11px; color: var(--faint); }
    .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--mono); color: var(--text-2); }
    mark { border-radius: 2px; background: var(--brand-bg); color: var(--text); box-shadow: inset 0 -1px 0 var(--brand); }
  `,
})
export class SearchPaletteComponent {
  protected readonly vm = inject(SearchPaletteVm);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('d');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('q');
  /** Dialogue fermé (Échap, clic à côté, session ouverte) : la coque retire la palette. */
  readonly closed = output();
  private ended = false;

  constructor() {
    afterNextRender(() => {
      const d = this.dialog().nativeElement;
      // jsdom n'a pas showModal : l'attribut open suffit aux tests.
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      this.input().nativeElement.focus();
    });
  }

  /** Ferme le dialogue (le navigateur rend le focus à l'élément d'origine) ; sans `close` natif (jsdom), émet `closed` lui-même. */
  protected close(): void {
    const d = this.dialog().nativeElement;
    if (d.close) d.close();
    else { d.removeAttribute('open'); this.done(); }
  }

  /** Événement `close` du dialogue : `closed` une seule fois. */
  protected done(): void {
    if (this.ended) return;
    this.ended = true;
    this.closed.emit();
  }

  protected key(e: KeyboardEvent): void {
    // Échap fermerait le dialogue nativement ; pris ici pour le même chemin partout (jsdom compris).
    if (e.key === 'Escape') { e.preventDefault(); return this.close(); }
    const r = this.vm.key(e.key);
    if (!r) return;
    e.preventDefault();
    if (r === 'pick') return this.close();
    afterNextRender(() => this.dialog().nativeElement.querySelector(`#palette-opt-${this.vm.index()}`)?.scrollIntoView?.({ block: 'nearest' }), { injector: this.injector });
  }

  protected pick(i: number): void {
    if (this.vm.pick(i)) this.close();
  }
}
