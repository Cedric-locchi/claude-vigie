import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { SessionFilesVm, base } from '../session-files.vm';

/**
 * Palette « Aller au fichier » (⌘P / Ctrl+P), dans un <dialog> natif : Échap ferme, le focus revient d'office.
 * Vue seule : la logique est dans `SessionFilesVm` (fourni par l'onglet Fichiers), qui appelle `open()`.
 */
@Component({
  selector: 'app-files-quick',
  template: `
    <dialog #d class="quick" aria-label="Aller au fichier" (click)="$event.target === d && d.close()">
      <input #q class="q-input" role="combobox" aria-expanded="true" aria-controls="quick-list" aria-autocomplete="list"
        [attr.aria-activedescendant]="vm.quickResults().length ? 'quick-' + vm.quickIndex() : null"
        placeholder="Nom ou chemin du fichier" aria-label="Nom ou chemin du fichier" autocomplete="off" spellcheck="false" [value]="vm.quickQuery()"
        (input)="vm.quickQuery.set($any($event.target).value)" (keydown)="key($event)" />
      <ul id="quick-list" #list class="q-list" role="listbox" aria-label="Fichiers">
        @for (f of vm.quickResults(); track f; let i = $index) {
          @let tc = vm.touchedByPath().get(f);
          <li role="option" [id]="'quick-' + i" [attr.aria-selected]="i === vm.quickIndex()" (click)="pick(f)" (mousemove)="vm.quickIndex.set(i)">
            <span class="name mono">{{ name(f) }}</span>
            <span class="dir">{{ dir(f) }}</span>
            @if (tc) {
              <svg class="ic" [class.edit]="tc.edited" viewBox="0 0 24 24" aria-hidden="true">
                @if (tc.edited) { <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /> }
                @else { <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /> }
              </svg>
              <span class="sr-only">, {{ tc.edited ? 'modifié' : 'lu' }} par Claude</span>
            }
          </li>
        } @empty {
          <li class="none">Aucun fichier ne correspond.</li>
        }
      </ul>
    </dialog>
  `,
  styles: `
    /* Flotte en haut, comme dans VS Code (seule ombre de l'onglet). */
    .quick {
      position: fixed; inset: 12vh auto auto 50%; translate: -50% 0; width: min(600px, calc(100vw - 32px)); max-height: 60vh; margin: 0; padding: 0;
      display: none; flex-direction: column; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--nav); color: var(--text);
      box-shadow: 0 8px 24px var(--shadow); overflow: hidden;
    }
    .quick[open] { display: flex; }
    .quick::backdrop { background: transparent; }
    .q-input { flex: none; height: 40px; padding: 0 14px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--text); font: inherit; font-size: 14px; outline: none; }
    .q-input:focus-visible { box-shadow: inset 0 -1px 0 var(--brand); }
    .q-list { flex: 1; min-height: 0; margin: 0; padding: 4px; overflow-y: auto; list-style: none; }
    li { display: flex; align-items: baseline; gap: 8px; height: 28px; padding: 0 10px; border-radius: 6px; line-height: 28px; font-size: 13px; cursor: pointer; white-space: nowrap; }
    li[aria-selected='true'] { background: var(--brand-bg); box-shadow: inset 2px 0 0 var(--brand); }
    .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .dir { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--faint); }
    .ic { flex: none; align-self: center; width: 12px; height: 12px; fill: none; stroke: var(--read); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ic.edit { stroke: var(--cmd); }
    .none { color: var(--faint); cursor: default; }
  `,
})
export class FilesQuickComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly name = base;
  protected readonly dir = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('d');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('q');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  open(): void {
    const d = this.dialog().nativeElement;
    this.vm.openQuick();
    // jsdom n'a pas showModal.
    if (!d.open) d.showModal?.();
    this.input().nativeElement.focus();
  }

  protected key(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      const f = this.vm.quickResults()[this.vm.quickIndex()];
      if (f) this.pick(f);
      return;
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !this.vm.quickStep(step)) return;
    e.preventDefault();
    this.list().nativeElement.querySelector(`#quick-${this.vm.quickIndex()}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  protected pick(path: string): void {
    this.dialog().nativeElement.close?.();
    void this.vm.open(path);
  }
}
