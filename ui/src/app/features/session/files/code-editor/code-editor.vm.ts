import { Injectable, Signal, computed, linkedSignal, signal } from '@angular/core';
import { FIND_MAX, Range, findAll, findParts } from './code-editor';

/**
 * Recherche dans le fichier ouvert (⌘F / Ctrl+F dans la vue Fichiers) : barre au-dessus du code, occurrences surlignées
 * sur un calque sous le texte, résultat courant. Sur le texte en LF, comme la <textarea> (les décalages sont les siens).
 */
@Injectable()
export class CodeEditorVm {
  private readonly source = signal<Signal<string> | null>(null);
  private readonly text = computed(() => (this.source()?.() ?? '').replace(/\r\n/g, '\n'));

  readonly open = signal(false);
  readonly query = signal('');
  readonly matchCase = signal(false);
  readonly matches = computed(() => (this.open() ? findAll(this.text(), this.query(), this.matchCase()) : []));
  /** Index du résultat courant, -1 sans résultat ; une frappe dans le code le borne sans le remettre à zéro. */
  readonly current = linkedSignal<Range[], number>({
    source: this.matches,
    computation: (m, prev) => (m.length ? Math.min(Math.max(prev?.value ?? 0, 0), m.length - 1) : -1),
  });
  /** Change à chaque déplacement demandé (saisie, suivant, précédent) : le composant fait défiler jusqu'au résultat courant. */
  readonly moved = signal(0);
  /** Position d'où chercher le premier résultat (curseur à l'ouverture, puis résultat courant). */
  private caret = 0;

  /** « 3/12 » à l'écran, « Résultat 3 sur 12 » pour un lecteur d'écran ; null sans saisie. */
  readonly count = computed(() => {
    const n = this.matches().length, i = this.current() + 1;
    if (!this.query()) return null;
    if (!n) return { text: 'Aucun résultat', label: 'Aucun résultat' };
    const total = n >= FIND_MAX ? `${FIND_MAX}+` : String(n);
    return { text: `${i}/${total}`, label: `Résultat ${i} sur ${n >= FIND_MAX ? `plus de ${FIND_MAX}` : n}` };
  });
  /** Calque de surlignage : vide sans résultat (le calque n'est pas rendu). */
  readonly parts = computed(() => (this.matches().length ? findParts(this.text(), this.matches(), this.current()) : []));

  connect(text: Signal<string>): void {
    this.source.set(text);
  }

  /** Ouvre la barre ; `seed` (sélection d'une ligne) remplace la saisie ; le résultat courant est le premier après `caret`. */
  start(seed: string, caret: number): void {
    this.open.set(true);
    if (seed) this.query.set(seed);
    this.caret = caret;
    this.seek();
  }

  setQuery(q: string): void {
    this.query.set(q);
    this.seek();
  }

  toggleCase(): void {
    this.matchCase.update((v) => !v);
    this.seek();
  }

  next(): void { this.step(1); }
  prev(): void { this.step(-1); }

  /** Ferme la barre ; rend le résultat courant (à sélectionner dans le code), null sans résultat. */
  close(): Range | null {
    const m = this.matches()[this.current()] ?? null;
    this.open.set(false);
    return m;
  }

  /** Premier résultat à partir de `caret`, sinon le premier du fichier. */
  private seek(): void {
    const i = this.matches().findIndex((m) => m.from >= this.caret);
    this.current.set(this.matches().length ? Math.max(i, 0) : -1);
    this.moved.update((n) => n + 1);
  }

  private step(d: number): void {
    const m = this.matches(), n = m.length;
    if (!n) return;
    const i = (this.current() + d + n) % n;
    this.current.set(i);
    this.caret = m[i].from;
    this.moved.update((k) => k + 1);
  }
}
