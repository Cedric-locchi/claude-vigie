import { Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, input, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { FilesActivityComponent, VIEWS } from './activity/files-activity.component';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { FilesClaudeHereComponent } from './claude-here/files-claude-here.component';
import { FilesEditorHeaderComponent } from './editor-header/files-editor-header.component';
import { FilesFinderComponent } from './finder/files-finder.component';
import { FilesFinderVm } from './finder/files-finder.vm';
import { FilesProjectComponent } from './project/files-project.component';
import { FilesSearchComponent } from './search/files-search.component';
import { FilesSearchVm } from './search/files-search.vm';
import { FilesStatusComponent } from './status-bar/files-status.component';
import { SessionFilesVm } from './session-files.vm';

const NARROW = '(max-width: 820px)';

/**
 * Vue Fichiers de la session, en trois panneaux séparés : rail d'activité en pilule (Projet, Rechercher, Claude), fenêtre d'outil
 * (en-tête de 32 px et ses boutons ; redimensionnable, masquable, tiroir sur écran étroit), éditeur (onglets, code, barre d'état) ;
 * ⌘P ouvre la fenêtre flottante « Aller au fichier ».
 */
@Component({
  selector: 'app-session-files',
  imports: [HlmButton, HlmTooltip, FilesActivityComponent, CodeEditorComponent, FilesClaudeHereComponent, FilesEditorHeaderComponent, FilesFinderComponent,
    FilesProjectComponent, FilesSearchComponent, FilesStatusComponent],
  providers: [SessionFilesVm, FilesSearchVm, FilesFinderVm],
  host: { '(document:keydown)': 'shortcut($event)' },
  template: `
    @let a = vm.active();
    @let side = vm.side();
    <div #ide class="ide" [class.drawer]="vm.drawer()" [class.collapsed]="!vm.panelShown()" [style.--w.px]="vm.width()">
      <app-files-activity />

      <aside class="side" id="files-side" [attr.aria-label]="title(side)" [inert]="!vm.panelShown()" (keydown.escape)="escape()">
        <header class="tw-head">
          <h2 class="tw-title">{{ title(side) }}</h2>
          @switch (side) {
            @case ('project') {
              <button type="button" class="tw-btn" aria-label="Localiser le fichier ouvert" hlmTooltip="Localiser le fichier ouvert" [showDelay]="300" [disabled]="!a" (click)="locate()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 2v3M12 19v3M2 12h3M19 12h3M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2" /></svg>
              </button>
              <button type="button" class="tw-btn" aria-label="Tout replier" hlmTooltip="Tout replier" [showDelay]="300" (click)="vm.collapseAll()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l5 5 5-5M7 20l5-5 5 5" /></svg>
              </button>
              <button type="button" class="tw-btn" aria-label="Relire l’arbre et le fichier" hlmTooltip="Relire l’arbre et le fichier" [showDelay]="300" [disabled]="vm.loading()" (click)="vm.refresh()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>
              </button>
            }
            @case ('search') {
              <button type="button" class="tw-btn aa" aria-label="Respecter la casse" hlmTooltip="Respecter la casse" [showDelay]="300" [attr.aria-pressed]="search.matchCase()" (click)="search.toggleCase()">Aa</button>
            }
          }
          <button type="button" class="tw-btn" aria-label="Masquer le panneau" [hlmTooltip]="vm.narrow() ? 'Masquer (Échap)' : 'Masquer le panneau'" [showDelay]="300" (click)="hide()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
          </button>
        </header>
        @switch (side) {
          @case ('project') { <app-files-project /> }
          @case ('search') { <app-files-search /> }
          @case ('claude') { <app-files-claude-here /> }
        }
        <div class="split" role="separator" aria-orientation="vertical" aria-label="Largeur du panneau" tabindex="0"
          aria-valuemin="180" aria-valuemax="560" [attr.aria-valuenow]="vm.width()" (pointerdown)="drag($event)" (keydown)="sizeKey($event)" (dblclick)="vm.resize(280)"></div>
      </aside>

      <section class="main" aria-label="Éditeur" tabindex="-1">
        <app-files-editor-header />
        @if (a) {
          @if (a.error; as e) { <p class="note" role="alert">{{ e }}</p> }
          @if (vm.error(); as e) { <p class="note" role="alert">{{ e }}</p> }
          @if (vm.editing() && a.conflict) {
            <p class="note" role="alert">Le fichier a changé sur le disque depuis que tu l'as ouvert. Recharger remplace ta saisie par sa version actuelle.
              <button hlmBtn variant="outline" size="sm" [disabled]="vm.loadingFile()" (click)="vm.load()">Recharger</button></p>
          }
          @if (vm.markdown(); as md) {
            <!-- [innerHTML] passe par le sanitizer d'Angular (scripts et handlers retirés). -->
            <div class="markdown md" [innerHTML]="md"></div>
          } @else if (a.body) {
            <app-code-editor [value]="vm.text()" [path]="a.path" [readonly]="!vm.editing()" [marks]="vm.marks()" [line]="vm.position().line" [wrap]="vm.wrap()"
              [label]="'Contenu de ' + a.path" [help]="vm.help()" [reveal]="vm.goto()" (edit)="vm.edit($event)" (caret)="vm.caret.set($event)" />
          } @else if (!a.error) {
            <p class="empty">Lecture…</p>
          }
        } @else {
          <div class="start">
            <h3>Ouvre un fichier</h3>
            <p class="muted">Choisis-le dans l’arbre ou cherche-le : tu vois et retouches ici ce que Claude fait au code.</p>
            <dl class="keys">
              <dt>Aller au fichier</dt><dd><kbd class="mono">{{ vm.keys.mod }}P</kbd></dd>
              <dt>Chercher dans le contenu</dt><dd><kbd class="mono">{{ vm.keys.mod }}{{ vm.keys.shift }}F</kbd></dd>
              <dt>Enregistrer</dt><dd><kbd class="mono">{{ vm.keys.mod }}S</kbd></dd>
              <dt>Quitter la vue Fichiers</dt><dd><kbd class="mono">{{ vm.keys.mod }}{{ vm.keys.shift }}E</kbd></dd>
            </dl>
          </div>
        }
        <app-files-status (reveal)="reveal($event)" />
      </section>
    </div>
    <app-files-finder (opened)="focusEditor()" (searched)="focusSearch()" />
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    /* Téléphone : la page de session défile au document ; l'éditeur garde une hauteur propre (tiroir, aller à la ligne), l'écran sous la barre mobile, comme le terminal. */
    @media (max-width: 720px) { :host { flex: none; height: calc(100dvh - var(--chrome-top)); } }
    /* Trois panneaux séparés sur le fond pointillé (décision 043) : rail en pilule, arbre, éditeur ; chacun défile seul. */
    .ide {
      --gap: 10px; position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: 44px var(--w) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
      column-gap: var(--gap); scrollbar-color: var(--line-strong) transparent; transition: grid-template-columns var(--dur) var(--ease), column-gap var(--dur) var(--ease);
    }
    /* Masqué : la colonne de l'arbre et un des deux écarts disparaissent, l'écart entre rail et éditeur reste le même. */
    .ide.collapsed { grid-template-columns: 44px 0 minmax(0, 1fr); column-gap: calc(var(--gap) / 2); }
    .ide.dragging { transition: none; }
    app-files-activity { align-self: start; }
    .side, .main { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--edge); border-radius: 12px; background: var(--surface); box-shadow: var(--elev-1); }
    .side { position: relative; }
    .ide.collapsed .side { overflow: hidden; border: 0; box-shadow: none; }
    app-files-status { margin-top: auto; }
    .tw-head { flex: none; display: flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px 0 12px; }
    .tw-title { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--text); }
    .tw-btn {
      flex: none; display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 4px; background: none; color: var(--faint); cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .tw-btn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
    .tw-btn:active:not(:disabled) { background: var(--press); }
    .tw-btn:disabled { cursor: default; color: var(--line-strong); }
    .tw-btn[aria-pressed='true'] { background: var(--brand-bg); color: var(--text); }
    .tw-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .tw-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .aa { font: 600 12px/1 var(--mono); }
    /* Poignée de largeur : invisible au repos, filet bleu au survol et au focus ; double-clic = largeur d'origine. */
    /* Centrée dans l'écart entre l'arbre et l'éditeur. */
    .split { position: absolute; top: 0; bottom: 0; right: calc(-3.5px - var(--gap) / 2); z-index: 3; width: 7px; cursor: col-resize; touch-action: none; }
    .split::after { content: ''; position: absolute; inset: 0 3px; background: transparent; transition: background-color var(--dur) var(--ease); }
    .split:hover::after, .split:focus-visible::after, .split:active::after { background: var(--brand); }
    .split:focus-visible { outline: none; }
    .main { overflow: hidden; outline: none; }
    .note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 6px 12px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--err); }
    .md { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px; scrollbar-width: thin; }
    .empty { margin: 0; padding: 16px; font-size: 13px; color: var(--faint); }
    .start { width: min(380px, 100%); margin: 0 auto; padding: 12vh 20px 20px; display: flex; flex-direction: column; gap: 12px; }
    .start h3 { margin: 0; font-size: 16px; font-weight: 600; }
    .start p { margin: 0; font-size: 13px; }
    .keys { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; margin: 4px 0 0; font-size: 13px; color: var(--text-muted); }
    .keys dd { margin: 0; text-align: right; }
    kbd { padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; font-size: 11px; color: var(--text-2); }
    /* Étroit : la fenêtre d'outil devient un tiroir posé sur l'éditeur, ouvert depuis la barre d'activité. */
    @media (max-width: 820px) {
      .ide, .ide.collapsed { grid-template-columns: 44px minmax(0, 1fr); column-gap: var(--gap); }
      app-files-activity { grid-row: 1; }
      .side, .ide.collapsed .side {
        display: none; position: absolute; inset: 0 auto 0 calc(44px + var(--gap)); z-index: 2; width: min(320px, calc(100% - 60px)); border: 1px solid var(--edge); box-shadow: var(--elev-2);
        transition: translate var(--dur) var(--ease), opacity var(--dur) var(--ease);
      }
      .ide.drawer .side { display: flex; }
      @starting-style { .ide.drawer .side { translate: -16px 0; opacity: 0; } }
      .split { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .ide, .side { transition: none; } }
  `,
})
export class SessionFilesComponent {
  protected readonly vm = inject(SessionFilesVm);
  protected readonly search = inject(FilesSearchVm);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly sessionId = input.required<string>();
  /** Claude ne travaille pas : l'édition est permise (le daemon applique la même règle). */
  readonly idle = input(false);
  private readonly ide = viewChild.required<ElementRef<HTMLElement>>('ide');
  private readonly finder = viewChild.required(FilesFinderComponent);
  private readonly project = viewChild(FilesProjectComponent);
  private readonly searchView = viewChild(FilesSearchComponent);
  protected readonly title = (v: string): string => VIEWS.find((x) => x.id === v)!.label;

  constructor() {
    this.vm.connect(this.sessionId, this.idle);
    // Tiroir sur écran étroit : le VM suit la media query.
    const mq = globalThis.matchMedia?.(NARROW);
    if (mq) {
      const sync = () => this.vm.narrow.set(mq.matches);
      sync();
      mq.addEventListener('change', sync);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', sync));
    }
  }

  protected shortcut(e: KeyboardEvent): void {
    const r = this.vm.shortcut(e);
    if (r === 'quick') this.finder().open();
    else if (r === 'search') this.focusSearch();
  }

  /** Masquer (bouton ou Échap dans le tiroir) : le focus revient au bouton de la vue dans la barre d'activité. */
  protected hide(): void {
    this.vm.showPanel(false);
    this.focus(`app-files-activity [data-view=${this.vm.side()}]`);
  }

  /** Échap dans le tiroir : il se ferme. */
  protected escape(): void {
    if (this.vm.narrow() && this.vm.drawer()) this.hide();
  }

  /** Fichier ouvert depuis ⌘P : le focus passe à l'éditeur (ou à sa zone, le temps de la lecture). */
  protected focusEditor(): void { this.focus('app-code-editor textarea', '.main'); }

  /** ⌘⇧F, ou « Chercher dans le contenu » depuis ⌘P : la vue Rechercher est affichée, focus dans son champ (après rendu). */
  protected focusSearch(): void {
    afterNextRender(() => this.searchView()?.focusField(), { injector: this.injector });
  }

  /** Fil d'Ariane de la barre d'état : montre le segment dans l'arbre et y met le focus. */
  protected reveal(path: string): void {
    this.vm.reveal(path);
    this.focusRow();
  }

  protected locate(): void {
    if (this.vm.locate()) this.focusRow();
  }

  /** Après rendu (la vue Projet vient peut-être d'apparaître) : focus sur la ligne désignée de l'arbre. */
  private focusRow(): void {
    afterNextRender(() => this.project()?.focusRow(), { injector: this.injector });
  }

  /** Glisser la poignée : la largeur suit le pointeur (sans transition), mémorisée à chaque pas. */
  protected drag(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement, start = e.clientX, w = this.vm.width(), ide = this.ide().nativeElement;
    el.setPointerCapture(e.pointerId);
    ide.classList.add('dragging');
    const move = (m: PointerEvent) => this.vm.resize(w + m.clientX - start);
    el.addEventListener('pointermove', move);
    // lostpointercapture : relâché ou annulé (pointercancel).
    el.addEventListener('lostpointercapture', () => { el.removeEventListener('pointermove', move); ide.classList.remove('dragging'); }, { once: true });
  }

  protected sizeKey(e: KeyboardEvent): void {
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    this.vm.resize(this.vm.width() + step);
  }

  /** Après rendu : focus sur le premier sélecteur présent. */
  private focus(...selectors: string[]): void {
    afterNextRender(() => {
      const root = this.host.nativeElement;
      for (const s of selectors) { const el = root.querySelector<HTMLElement>(s); if (el) return el.focus(); }
    }, { injector: this.injector });
  }
}
