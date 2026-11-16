import { Component, ElementRef, Injector, afterNextRender, inject, output, viewChild } from '@angular/core';
import { Icon } from '../../../../core/icon.component';
import { FileIconComponent } from '../file-icon/file-icon.component';
import { SessionFilesVm, base } from '../session-files.vm';
import { FilesFinderVm, FinderMove } from './files-finder.vm';

/**
 * Fenêtre flottante « Aller au fichier » (⌘P / Ctrl+P), dans un <dialog> natif centré en haut de l'écran : combobox + listbox,
 * Échap ferme et le navigateur rend le focus à l'élément d'origine. Seule ombre de la vue Fichiers.
 * Vue seule : la logique est dans `FilesFinderVm`.
 */
@Component({
  selector: 'app-files-finder',
  imports: [Icon, FileIconComponent],
  template: `
    @let hits = vm.hits();
    <dialog #d class="quick" aria-label="Aller au fichier" (click)="$event.target === d && close()">
      <div class="field">
        <svg appIcon="search" class="lens"></svg>
        <input #q class="q" type="text" role="combobox" aria-expanded="true" aria-controls="finder-list" aria-autocomplete="list"
          [attr.aria-activedescendant]="vm.count() ? 'finder-opt-' + vm.index() : null" placeholder="Nom ou chemin du fichier" aria-label="Aller au fichier"
          maxlength="200" autocomplete="off" spellcheck="false" [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" (keydown)="key($event)" />
      </div>
      <ul id="finder-list" class="list" role="listbox" aria-label="Fichiers">
        @for (f of hits; track f; let i = $index) {
          @let tc = files.touchedByPath().get(f);
          <li role="option" class="opt" [id]="'finder-opt-' + i" [attr.aria-selected]="i === vm.index()" (click)="pick(i)" (mousemove)="vm.index.set(i)">
            <app-file-icon [path]="f" />
            <span class="name">{{ name(f) }}</span><span class="dir">{{ dir(f) }}</span>
            @if (tc) { <span class="mark" [class.edit]="tc.edited" aria-hidden="true"></span><span class="sr-only">, {{ tc.edited ? 'modifié' : 'lu' }} par Claude</span> }
          </li>
        } @empty {
          @if (!vm.q()) { <li class="none">Aucun fichier dans le projet.</li> }
        }
        @if (vm.q()) {
          <li role="option" class="opt action" [id]="'finder-opt-' + hits.length" [attr.aria-selected]="hits.length === vm.index()" (click)="pick(hits.length)" (mousemove)="vm.index.set(hits.length)">
            <svg appIcon="search" class="ic"></svg><span class="label">Chercher « {{ vm.q() }} » dans le contenu</span>
          </li>
        }
      </ul>
    </dialog>
  `,
  styles: `
    .quick {
      position: fixed; inset: 12vh auto auto 50%; translate: -50% 0; width: min(620px, calc(100vw - 32px)); max-height: 60vh; margin: 0; padding: 0;
      display: none; flex-direction: column; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--nav); color: var(--text);
      box-shadow: 0 8px 24px var(--shadow); overflow: hidden;
    }
    .quick[open] { display: flex; }
    @starting-style { .quick[open] { opacity: 0; translate: -50% -6px; } }
    .quick { transition: opacity var(--dur-fast) var(--ease), translate var(--dur-fast) var(--ease); }
    .quick::backdrop { background: transparent; }
    .field { position: relative; flex: none; border-bottom: 1px solid var(--line); }
    .lens { position: absolute; left: 12px; top: 12px; width: 16px; height: 16px; color: var(--faint); stroke-linecap: round; pointer-events: none; }
    .q { width: 100%; height: 40px; padding: 0 14px 0 36px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 14px; outline: none; }
    .q::placeholder { color: var(--faint); }
    .field:focus-within { box-shadow: inset 0 -1px 0 var(--brand); }
    .list { flex: 1; min-height: 0; margin: 0; padding: 4px; overflow-y: auto; list-style: none; scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
    .opt { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border-radius: 4px; font-size: 13px; color: var(--text-2); cursor: pointer; white-space: nowrap; }
    .opt[aria-selected='true'] { background: var(--brand-bg); color: var(--text); }
    .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
    .dir { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; margin-left: 4px; font-size: 12px; color: var(--faint); }
    .mark { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--read); }
    .mark.edit { background: var(--cmd); }
    .action { margin-top: 4px; color: var(--text-muted); box-shadow: 0 -1px 0 var(--line); border-radius: 0 0 4px 4px; }
    .action .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .ic { flex: none; width: 15px; height: 15px; margin-inline: 1px 2px; stroke-linecap: round; color: var(--faint); }
    .none { padding: 6px 8px; font-size: 13px; color: var(--faint); }
    @media (prefers-reduced-motion: reduce) { .quick { transition: none; } }
  `,
})
export class FilesFinderComponent {
  protected readonly vm = inject(FilesFinderVm);
  protected readonly files = inject(SessionFilesVm);
  private readonly injector = inject(Injector);
  protected readonly name = base;
  protected readonly dir = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')));
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('d');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('q');
  /** Fichier ouvert : le parent passe le focus à l'éditeur. */
  readonly opened = output();
  /** « Chercher dans le contenu » : le parent met le focus dans le champ de la vue Rechercher. */
  readonly searched = output();

  open(): void {
    const d = this.dialog().nativeElement;
    this.vm.reset();
    // jsdom n'a pas showModal : l'attribut open suffit aux tests.
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    afterNextRender(() => this.input().nativeElement.focus(), { injector: this.injector });
  }

  protected close(): void {
    const d = this.dialog().nativeElement;
    if (d.close) d.close(); else d.removeAttribute('open');
  }

  protected key(e: KeyboardEvent): void {
    const r = this.vm.key(e.key);
    if (!r.handled) return;
    e.preventDefault();
    if (r.move) return this.after(r.move);
    afterNextRender(() => this.dialog().nativeElement.querySelector(`#finder-opt-${this.vm.index()}`)?.scrollIntoView?.({ block: 'nearest' }), { injector: this.injector });
  }

  protected pick(i: number): void {
    const move = this.vm.pick(i);
    if (move) this.after(move);
  }

  private after(move: Exclude<FinderMove, null>): void {
    this.close();
    if (move === 'opened') this.opened.emit();
    else this.searched.emit();
  }
}
