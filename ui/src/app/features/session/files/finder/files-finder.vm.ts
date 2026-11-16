import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { FilesSearchVm } from '../search/files-search.vm';
import { SessionFilesVm, quickMatch } from '../session-files.vm';

/** Fichiers proposés dans la fenêtre : au-delà, on affine la saisie. */
export const MAX_HITS = 30;

/** Suite pour le composant : fichier ouvert (focus à l'éditeur), vue Rechercher pré-remplie (focus dans son champ), ou rien. */
export type FinderMove = 'opened' | 'search' | null;

/**
 * Fenêtre flottante « Aller au fichier » (⌘P / Ctrl+P), comme la recherche universelle de WebStorm : fichiers en recherche
 * floue (saisie vide : onglets ouverts et fichiers touchés par Claude d'abord), puis une dernière ligne
 * « Chercher « … » dans le contenu » qui ouvre la vue Rechercher pré-remplie.
 */
@Injectable()
export class FilesFinderVm {
  private readonly files = inject(SessionFilesVm);
  private readonly search = inject(FilesSearchVm);

  readonly query = signal('');
  readonly q = computed(() => this.query().trim());

  readonly hits = computed(() => {
    const q = this.q();
    if (q) return quickMatch(this.files.files(), q, MAX_HITS);
    const recent = [...this.files.tabs().map((t) => t.path), ...this.files.touched().map((t) => t.path)];
    return [...new Set([...recent, ...this.files.files()])].slice(0, MAX_HITS);
  });
  /** Options de la liste : les fichiers, puis la ligne « dans le contenu » (index `hits().length`) dès qu'il y a une saisie. */
  readonly count = computed(() => this.hits().length + (this.q() ? 1 : 0));
  readonly index = linkedSignal({ source: () => `${this.q()}|${this.hits().length}`, computation: () => 0 });

  /** À l'ouverture : saisie vide. */
  reset(): void { this.query.set(''); }

  /** Clic ou Entrée sur une option : ouvre le fichier (gardé, pas en aperçu), ou cherche la saisie dans le contenu. */
  pick(i: number): FinderMove {
    const path = this.hits()[i];
    if (path) {
      void this.files.open(path);
      return 'opened';
    }
    if (i !== this.hits().length || !this.q()) return null;
    this.search.query.set(this.q());
    this.files.showSide('search');
    return 'search';
  }

  /** Touche dans le champ (flèches circulaires, Entrée) ; Échap est laissé au <dialog>. */
  key(key: string): { handled: boolean; move: FinderMove } {
    const n = this.count();
    const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
    if (step) {
      if (n) this.index.set((this.index() + step + n) % n);
      return { handled: n > 0, move: null };
    }
    if (key === 'Enter') return { handled: true, move: this.pick(this.index()) };
    return { handled: false, move: null };
  }
}
