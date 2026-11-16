import { Component, computed, inject, input } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { SessionFilesVm } from './session-files.vm';

/**
 * Liste « Touchés par Claude » : fichiers lus (œil) ou modifiés (crayon lilas, comme les outils dans la chronologie),
 * du plus récent au plus ancien. Vue seule : la logique est dans `SessionFilesVm` (fourni par l'onglet Fichiers).
 */
@Component({
  selector: 'app-files-touched',
  imports: [HlmTooltip],
  template: `
    @let active = vm.active()?.path;
    <ul class="list" [attr.aria-label]="label()">
      @for (t of items(); track t.path) {
        @let cut = t.path.lastIndexOf('/');
        @let parent = cut > 0 ? t.path.slice(t.path.lastIndexOf('/', cut - 1) + 1, cut) : '';
        <li>
          <button type="button" class="item" [class.on]="t.path === active" [attr.aria-current]="t.path === active || null" (click)="vm.open(t.path)"
            [hlmTooltip]="t.path + ' · tour ' + t.turn + ' · ' + t.count + ' fois'" [showDelay]="500">
            @if (t.edited) {
              <svg class="ic edit" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            } @else {
              <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /></svg>
            }
            <!-- Nom d'abord (c'est ce qu'on cherche), puis le dossier parent en retrait pour départager ; chemin complet en infobulle. -->
            <span class="path"><span class="name mono">{{ t.path.slice(cut + 1) }}</span>@if (parent) { <span class="dir">{{ parent }}</span> }</span>
            <span class="sr-only">, {{ t.edited ? 'modifié' : 'lu' }} au tour {{ t.turn }}, il y a {{ vm.age(t) }}, {{ t.count }} fois</span>
            <span class="meta mono" aria-hidden="true">{{ vm.age(t) }}</span>
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: block; }
    .list { margin: 0; padding: 0 8px 4px; list-style: none; }
    .item {
      display: flex; align-items: center; gap: 6px; width: 100%; height: 26px; padding: 0 8px; border: 0; border-radius: 6px;
      background: none; color: var(--text-2); font-size: 12px; text-align: left; cursor: pointer; transition: background-color var(--dur-fast) var(--ease);
    }
    .item:hover { background: var(--hover); color: var(--text); }
    .item:active { background: var(--press); }
    .item.on { background: var(--brand-bg); color: var(--text); }
    .item:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .ic { flex: none; width: 13px; height: 13px; fill: none; stroke: var(--read); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ic.edit { stroke: var(--cmd); }
    .path { min-width: 0; flex: 1; display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
    /* Le dossier se tronque avant le nom du fichier. */
    .path > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .dir { flex: 0 100 auto; font-size: 11px; color: var(--faint); }
    .name { flex: 0 1 auto; }
    .meta { flex: none; font-size: 11px; color: var(--faint); }
  `,
})
export class FilesTouchedComponent {
  protected readonly vm = inject(SessionFilesVm);
  /** Nombre maximal d'éléments (null : tous). */
  readonly limit = input<number | null>(null);
  readonly label = input('Fichiers touchés par Claude');
  protected readonly items = computed(() => { const n = this.limit(), all = this.vm.touched(); return n ? all.slice(0, n) : all; });
}
