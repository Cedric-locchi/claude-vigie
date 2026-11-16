import { Component, ElementRef, afterRenderEffect, computed, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { highlight } from '../../../../core/highlight';
import { GitMark, indent, lineCount } from './code-editor';

/** Au-delà, pas de coloration (highlight.js à chaque frappe deviendrait sensible) : même éditeur, texte brut. */
export const HIGHLIGHT_MAX = 100_000;

let uid = 0;
/** Interligne et marge haute du texte (px) : les mêmes que `--lh` et `--pad` de `.sheet`. */
const LH = 18, PAD = 8;

/**
 * Éditeur de code sans dépendance : une <textarea> au texte transparent (seul le curseur et la sélection se voient)
 * posée sur un <pre> coloré aux métriques identiques, dans la même cellule de grille : ils défilent ensemble par construction.
 * ponytail: superposition textarea/pre ; CodeMirror si on veut annuler multi-niveaux, recherche intégrée, pliage.
 */
@Component({
  selector: 'app-code-editor',
  imports: [HlmTooltip],
  template: `
    <div class="scroll" #scroll>
      <div class="sheet" [class.wrap]="wrap()" [style.--digits]="digits()">
        <!-- Retour à la ligne : une ligne du fichier peut occuper plusieurs lignes à l'écran, la gouttière et la ligne courante
             (placées au calcul, ligne n = n × interligne) seraient fausses ; on les retire plutôt que de mesurer le DOM. -->
        @if (!wrap()) {
          <div class="cur" aria-hidden="true" [style.--l]="line() - 1"></div>
          <div class="gutter">
            <pre class="nums" aria-hidden="true">{{ numbers() }}</pre>
            @for (m of marks(); track m.kind + m.from) {
              <button type="button" class="mark" [attr.data-kind]="m.kind" [style.--l]="m.from - 1" [style.--n]="m.to - m.from + 1" [attr.aria-label]="m.label" [hlmTooltip]="m.label"></button>
            }
          </div>
        }
        <div class="stack">
          @if (html(); as h) {
            <pre class="code hl" aria-hidden="true" [innerHTML]="h"></pre>
          } @else {
            <pre class="code" aria-hidden="true" [textContent]="value() + '\\n'"></pre>
          }
          <textarea #ta [attr.wrap]="wrap() ? 'soft' : 'off'" spellcheck="false" autocomplete="off" autocapitalize="off" [attr.aria-label]="label()" [attr.aria-describedby]="helpId"
            [readOnly]="readonly()" [value]="value()" (input)="changed(ta)" (keydown)="key($event, ta)"
            (keyup)="caret.emit(ta.selectionStart)" (click)="caret.emit(ta.selectionStart)" (select)="caret.emit(ta.selectionStart)" (focus)="caret.emit(ta.selectionStart)"
            (scroll)="ta.scrollTop = 0; ta.scrollLeft = 0"></textarea>
        </div>
      </div>
    </div>
    <p class="sr-only" [id]="helpId">{{ help() }}</p>
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; }
    .scroll { flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    /* Ligne qui dépasse à droite : ombre fixée au bord (scroll), masquée par un cache collé à la fin du contenu (local). */
    .scroll {
      background:
        linear-gradient(var(--surface), var(--surface)) right / 20px 100% no-repeat local,
        linear-gradient(to left, color-mix(in oklch, var(--text) 14%, transparent), transparent) right / 20px 100% no-repeat scroll,
        var(--surface);
    }
    .scroll:has(textarea:focus) { outline: 2px solid var(--brand); outline-offset: -2px; }
    /* Métriques en px fixes : la ligne courante et les marqueurs se placent au calcul, sans mesurer le DOM. */
    .sheet {
      --lh: 18px; --pad: 8px; position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); min-width: max-content; min-height: 100%;
      font: 12px / var(--lh) var(--mono); font-variant-ligatures: none; letter-spacing: 0;
    }
    .cur { position: absolute; left: 0; right: 0; top: calc(var(--pad) + var(--l) * var(--lh)); height: var(--lh); background: var(--hover); pointer-events: none; }
    .wrap { min-width: 0; grid-template-columns: minmax(0, 1fr); }
    .gutter { position: sticky; left: 0; z-index: 1; padding: var(--pad) 12px var(--pad) 12px; background: var(--surface); border-right: 1px solid var(--line); }
    .nums { margin: 0; font: inherit; min-width: calc(var(--digits) * 1ch); text-align: right; color: var(--faint); white-space: pre; user-select: none; }
    .mark { position: absolute; right: 1px; width: 9px; top: calc(var(--pad) + var(--l) * var(--lh)); height: calc(var(--n) * var(--lh)); padding: 0; border: 0; background: none; cursor: pointer; }
    .mark::before { content: ''; position: absolute; inset: 1px 3px 1px 3px; border-radius: 1px; background: var(--ok); }
    .mark[data-kind='mod']::before { background: var(--brand); }
    /* Suppression : petit triangle à cheval sur la limite entre deux lignes. */
    .mark[data-kind='del'] { height: 10px; margin-top: -5px; }
    .mark[data-kind='del']::before { inset: 1px 0 1px 3px; border-radius: 0; background: var(--err); clip-path: polygon(0 0, 100% 50%, 0 100%); }
    .mark:focus-visible { outline: 2px solid var(--brand); outline-offset: 0; }
    /* Positionné : peint après la bande de ligne courante (.cur), donc le texte reste dessus. */
    .stack { position: relative; display: grid; }
    /* pre et textarea : mêmes police, taille, interligne, marges, tabulations et retour à la ligne, sinon le curseur décroche du texte. */
    .stack > * {
      grid-area: 1 / 1; box-sizing: border-box; margin: 0; padding: var(--pad) 24px var(--pad) 12px; border: 0;
      font: inherit; font-variant-ligatures: none; letter-spacing: 0; tab-size: 2; white-space: pre; overflow-wrap: normal; word-break: normal;
    }
    .wrap .stack > * { white-space: pre-wrap; overflow-wrap: anywhere; }
    .code { color: var(--text-2); pointer-events: none; }
    textarea { width: 100%; height: 100%; resize: none; overflow: hidden; background: transparent; color: transparent; caret-color: var(--text); outline: none; }
    textarea::selection { color: transparent; background: color-mix(in oklch, var(--brand) 35%, transparent); }
    /* Coloration : jetons du thème, clair comme sombre. */
    .hl ::ng-deep :is(.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-doctag) { color: var(--cmd); }
    .hl ::ng-deep :is(.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-template-tag) { color: var(--ok); }
    .hl ::ng-deep :is(.hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet, .hljs-variable.language_) { color: var(--read); }
    .hl ::ng-deep :is(.hljs-title, .hljs-section, .hljs-name, .hljs-selector-class, .hljs-selector-id, .hljs-type) { color: var(--brand); }
    .hl ::ng-deep :is(.hljs-attr, .hljs-property, .hljs-params, .hljs-meta) { color: var(--text); }
    /* Pas d'italique ni de gras : un glyphe plus large ou penché décalerait le texte sous le curseur. */
    .hl ::ng-deep :is(.hljs-comment, .hljs-quote) { color: var(--faint); }
    .hl ::ng-deep .hljs-deletion { color: var(--err); }
    @media (max-width: 820px) {
      .gutter { padding-inline: 6px 10px; }
      .stack > * { padding-left: 8px; }
    }
  `,
})
export class CodeEditorComponent {
  readonly value = input.required<string>();
  /** Chemin du fichier : choisit le langage de coloration. */
  readonly path = input.required<string>();
  readonly readonly = input(true);
  readonly marks = input<GitMark[]>([]);
  /** Ligne du curseur (1-based), surlignée. */
  readonly line = input(1);
  readonly label = input('');
  /** Retour à la ligne (sans gouttière ni ligne courante). */
  readonly wrap = input(false);
  /** Aide clavier lue par les lecteurs d'écran (aria-describedby). */
  readonly help = input('');
  /** Ligne à montrer (résultat de recherche) : défile jusqu'à elle et y pose le curseur ; un nouvel objet redemande, même ligne. */
  readonly reveal = input<{ line: number; offset: number } | null>(null);
  readonly edit = output<string>();
  readonly caret = output<number>();

  protected readonly helpId = `code-help-${uid++}`;
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');
  private readonly ta = viewChild.required<ElementRef<HTMLTextAreaElement>>('ta');
  /** Texte coloré : recalculé au plus une fois par frame pendant la frappe. */
  private readonly painted = signal('');
  protected readonly html = computed(() => {
    const v = this.painted();
    return v.length > HIGHLIGHT_MAX ? null : highlight(this.path(), v)?.concat('\n') ?? null;
  });
  private readonly count = computed(() => lineCount(this.value()));
  protected readonly numbers = computed(() => Array.from({ length: this.count() }, (_, i) => i + 1).join('\n'));
  protected readonly digits = computed(() => String(this.count()).length);
  /** Échap puis Tab : Tab rend le focus au lieu d'indenter (le clavier n'est pas piégé). */
  private escaped = false;

  constructor() {
    effect((onCleanup) => {
      const v = this.value();
      if (typeof requestAnimationFrame !== 'function') return this.painted.set(v);
      const raf = requestAnimationFrame(() => this.painted.set(v));
      onCleanup(() => cancelAnimationFrame(raf));
    });
    // Autre fichier : retour en haut.
    effect(() => {
      this.path();
      untracked(() => { const el = this.scroll().nativeElement; el.scrollTop = 0; el.scrollLeft = 0; });
    });
    // Après rendu : le texte du fichier est en place, la hauteur aussi. La ligne visée arrive au premier tiers de la vue.
    afterRenderEffect(() => {
      const r = this.reveal();
      if (!r) return;
      untracked(() => {
        const el = this.scroll().nativeElement;
        this.ta().nativeElement.setSelectionRange(r.offset, r.offset);
        // ponytail: en retour à la ligne, position estimée au prorata des lignes (pas de mesure du DOM) ; mesurer la ligne si l'écart gêne.
        const top = this.wrap() ? (el.scrollHeight * (r.line - 1)) / this.count() : PAD + (r.line - 1) * LH;
        el.scrollTop = Math.max(0, top - el.clientHeight / 3);
        el.scrollLeft = 0;
      });
    });
  }

  protected changed(ta: HTMLTextAreaElement): void {
    this.edit.emit(ta.value);
    this.caret.emit(ta.selectionStart);
  }

  protected key(e: KeyboardEvent, ta: HTMLTextAreaElement): void {
    if (e.key === 'Escape') { this.escaped = true; return; }
    const escaped = this.escaped;
    this.escaped = false;
    if (e.key !== 'Tab' || escaped || this.readonly() || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const ed = indent(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
    if (!ed) return;
    ta.setSelectionRange(ed.from, ed.to);
    // execCommand garde l'annulation native (⌘Z / Ctrl+Z) et émet `input` ; sinon (jsdom) setRangeText.
    if (!document.execCommand?.('insertText', false, ed.insert)) {
      ta.setRangeText(ed.insert);
      this.edit.emit(ta.value);
    }
    ta.setSelectionRange(ed.start, ed.end);
    this.caret.emit(ed.start);
  }
}
