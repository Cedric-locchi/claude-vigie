import { Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, input, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { CodeEditorComponent } from './code-editor/code-editor.component';
import { FilesActivityComponent } from './activity/files-activity.component';
import { FilesQuickComponent } from './quick-open/files-quick.component';
import { FilesSearchComponent } from './search/files-search.component';
import { FilesSearchVm } from './search/files-search.vm';
import { FilesStatusComponent } from './status-bar/files-status.component';
import { FilesTabsComponent } from './tabs/files-tabs.component';
import { FilesTouchedComponent } from './touched/files-touched.component';
import { Icon } from '../../../core/icon.component';
import { SessionFilesVm, SideView, base } from './session-files.vm';

const NARROW = '(max-width: 820px)';

/**
 * Onglet Fichiers, façon VS Code : barre d'activité (Explorateur, Aller au fichier, Rechercher, Touchés par Claude),
 * panneau latéral redimensionnable, onglets (aperçu en italique), éditeur coloré, barre d'état qui signale quand Claude travaille.
 */
@Component({
  selector: 'app-session-files',
  imports: [Icon, HlmButton, HlmInput, HlmTooltip, CodeEditorComponent, FilesActivityComponent, FilesQuickComponent, FilesSearchComponent, FilesStatusComponent, FilesTabsComponent, FilesTouchedComponent],
  providers: [SessionFilesVm, FilesSearchVm],
  host: { '(document:keydown)': 'shortcut($event)' },
  template: `
    @let p = vm.project();
    @let a = vm.active();
    @let ch = vm.changes();
    @let side = vm.side();
    <div class="ide" [class.drawer]="vm.drawer()" [style.--w.px]="vm.width()">
      <app-files-activity (quick)="quick().open()" />

      <aside class="side" id="files-side" [attr.aria-label]="VIEW_LABEL[side]">
        @switch (side) {
          @case ('tree') {
            <div class="side-head">
              @if (vm.listError(); as e) {
                <span class="text-err small" role="alert">{{ e }}</span>
              } @else if (!p) {
                <span class="small faint">Lecture du projet…</span>
              } @else {
                <h2 class="title mono" [hlmTooltip]="p.root" [showDelay]="500">{{ name(p.root) }}</h2>
                <span class="small faint">{{ vm.files().length }}</span>
              }
              <button hlmBtn variant="ghost" size="icon-sm" class="head-btn" aria-label="Rafraîchir l’arbre et le fichier" [disabled]="vm.loading()" (click)="vm.refresh()">
                <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="REFRESH" /></svg>
              </button>
            </div>
            <input hlmInput type="search" class="filter" placeholder="Filtrer l’arbre" aria-label="Filtrer l’arbre par chemin"
              autocomplete="off" spellcheck="false" [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" />
            @if (p?.truncated) { <p class="warn small" role="status">Plus de 20 000 entrées : la liste est incomplète.</p> }
            @let t = vm.view();
            <div #tree class="tree" role="tree" aria-label="Fichiers du projet" (keydown)="treeKey($event)">
              @for (r of t.rows; track r.path) {
                @let tc = vm.touchedByPath().get(r.path);
                @let ed = vm.editedDirs().get(r.path);
                <div role="treeitem" class="row" [class.ignored]="r.kind === 'ignored'" [style.--depth]="r.depth" [attr.data-path]="r.path"
                  [attr.tabindex]="r.path === vm.focusRow() ? 0 : -1" [attr.aria-level]="r.depth + 1"
                  [attr.aria-expanded]="r.kind === 'dir' ? r.open : null" [attr.aria-selected]="r.kind === 'file' ? a?.path === r.path : null"
                  [attr.aria-disabled]="r.kind === 'ignored' || null" (click)="vm.pick(r)" (dblclick)="r.kind === 'file' && vm.pin(r.path)">
                  @if (r.kind === 'file') { <span class="ic" aria-hidden="true"></span> } @else {
                    <svg appIcon="chevron" class="ic" [class.open]="r.open"></svg>
                    <svg class="ic folder" viewBox="0 0 24 24" aria-hidden="true">
                      @if (r.open) { <path d="M6 14l1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3" /> }
                      @else { <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> }
                    </svg>
                  }
                  <!-- ponytail: infobulle native (title) : des milliers de lignes, pas une directive de tooltip par ligne. -->
                  <span class="name" [attr.title]="r.name">{{ r.name }}</span>
                  @if (tc) {
                    <svg class="ic touch" [class.edit]="tc.edited" viewBox="0 0 24 24" aria-hidden="true">
                      @if (tc.edited) { <path [attr.d]="PENCIL" /> } @else { <path [attr.d]="EYE" /> }
                    </svg>
                    <span class="sr-only">, {{ tc.edited ? 'modifié' : 'lu' }} par Claude</span>
                  } @else if (ed) {
                    <span class="touch edit mono" aria-hidden="true"><svg class="ic" viewBox="0 0 24 24"><path [attr.d]="PENCIL" /></svg>{{ ed }}</span>
                    <span class="sr-only">, {{ ed }} fichier{{ ed > 1 ? 's' : '' }} modifié{{ ed > 1 ? 's' : '' }} par Claude</span>
                  }
                  @if (r.kind === 'ignored') { <span class="sr-only">, ignoré, contenu non listé</span> }
                  @if (r.kind === 'file' && ch.files.get(r.path); as f) {
                    <span class="st mono" [attr.data-st]="f.status"><span aria-hidden="true">{{ vm.STATUS[f.status].label }}</span><span class="sr-only">, {{ vm.STATUS[f.status].hint }}</span></span>
                  } @else if (r.kind === 'dir' && ch.dirs.has(r.path)) {
                    <span class="dot" aria-hidden="true"></span><span class="sr-only">, contient des changements</span>
                  }
                </div>
              } @empty {
                <p class="empty">{{ vm.query().trim() ? 'Aucun chemin ne correspond.' : p ? 'Projet vide.' : '' }}</p>
              }
              @if (t.limited) { <p class="empty small">Trop de résultats : affine le filtre.</p> }
            </div>
          }
          @case ('search') { <app-files-search /> }
          @case ('claude') {
            <div class="side-head"><h2 class="title">Touchés par Claude</h2></div>
            @if (vm.touched().length) { <app-files-touched class="scroll" /> }
            @else { <p class="empty small">Claude n’a encore ouvert aucun fichier dans cette session.</p> }
          }
        }
        <div class="split" role="separator" aria-orientation="vertical" aria-label="Largeur du panneau latéral" tabindex="0"
          aria-valuemin="180" aria-valuemax="560" [attr.aria-valuenow]="vm.width()" (pointerdown)="drag($event)" (keydown)="sizeKey($event)" (dblclick)="vm.resize(280)"></div>
      </aside>

      <section class="main" aria-label="Fichiers ouverts">
        @if (vm.tabs().length) { <app-files-tabs /> }

        @if (a) {
          <div class="bar">
            <nav class="crumbs mono small" aria-label="Chemin du fichier">
              @for (c of vm.crumbs(); track c.path; let last = $last) {
                @if (last) { <span class="here" aria-current="location">{{ c.name }}</span> }
                @else { <button type="button" class="crumb" [attr.aria-label]="'Montrer ' + c.path + ' dans l’arbre'" (click)="reveal(c.path)">{{ c.name }}</button><svg appIcon="chevron" class="sep"></svg> }
              }
            </nav>
            @if (vm.activeTouch(); as t) {
              @if (t.editTurn) {
                <span class="by small"><span>Modifié par Claude au tour {{ t.editTurn }}</span>
                  @if (vm.canShowHistory) { <button type="button" class="link" (click)="vm.showInHistory(t)">Voir dans l’historique</button> }</span>
              }
            }
            <div class="actions">
              @if (vm.editing()) {
                <button hlmBtn variant="ghost" size="sm" (click)="vm.cancelEdit()">Annuler</button>
                <button hlmBtn size="sm" [disabled]="!vm.idle() || vm.saving()" [attr.aria-keyshortcuts]="vm.keys.aria + '+S'" (click)="vm.save()" [hlmTooltip]="vm.idle() ? 'Écrit le fichier sur le disque (' + vm.keys.mod + 'S)' : BUSY">{{ vm.saving() ? 'Enregistrement…' : 'Enregistrer' }}</button>
              } @else if (a.body) {
                <button hlmBtn variant="ghost" size="sm" [disabled]="!vm.idle() || vm.loadingFile()" (click)="vm.startEdit()" [hlmTooltip]="vm.idle() ? 'Modifier ce fichier à la main' : BUSY">{{ vm.loadingFile() ? 'Lecture…' : 'Éditer' }}</button>
              }
              @if (!vm.editing() && a.body && vm.isMd()) {
                <button hlmBtn variant="ghost" size="icon-sm" aria-label="Aperçu mis en forme" [attr.aria-pressed]="!vm.showSource()" (click)="vm.showSource.set(!vm.showSource())" hlmTooltip="Aperçu mis en forme" [showDelay]="300">
                  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="EYE" /></svg>
                </button>
              }
              @if (!vm.markdown()) {
                <button hlmBtn variant="ghost" size="icon-sm" aria-label="Retour à la ligne" [attr.aria-pressed]="vm.wrap()" (click)="vm.toggleWrap()" hlmTooltip="Retour à la ligne (sans numéros de ligne)" [showDelay]="300">
                  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="WRAP" /></svg>
                </button>
              }
            </div>
          </div>
          @if (a.error; as e) { <p class="note small" role="alert">{{ e }}</p> }
          @if (vm.error(); as e) { <p class="note small" role="alert">{{ e }}</p> }
          @if (vm.editing() && a.conflict) {
            <p class="note small" role="alert">Le fichier a changé sur le disque depuis que tu l'as ouvert. Recharger remplace ta saisie par sa version actuelle.
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
            <dl class="keys small">
              <dt>Aller au fichier</dt><dd><kbd class="mono">{{ vm.keys.mod }}P</kbd></dd>
              <dt>Rechercher dans les fichiers</dt><dd><kbd class="mono">{{ vm.keys.mod }}{{ vm.keys.shift }}F</kbd></dd>
              <dt>Enregistrer</dt><dd><kbd class="mono">{{ vm.keys.mod }}S</kbd></dd>
              <dt>Garder un onglet d’aperçu</dt><dd>double-clic</dd>
            </dl>
            @if (vm.touched().length) {
              <h4 class="small faint">Derniers touchés par Claude</h4>
              <app-files-touched [limit]="5" label="Derniers fichiers touchés par Claude" />
            }
          </div>
        }
      </section>

      <app-files-status />
    </div>

    <app-files-quick />
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .ide {
      --act: 44px; position: relative; flex: 1; min-height: 0; display: grid;
      grid-template-columns: var(--act) var(--w) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden;
    }

    .side { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: var(--surface); }
    .side-head { flex: none; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 4px 0 12px; }
    .title { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; color: var(--text); }
    .head-btn { margin-left: auto; }
    .warn { margin: 0 12px; color: var(--text-muted); }
    .filter { flex: none; margin: 0 8px 4px; width: auto; height: 30px; font-size: 12px; }
    .tree, .scroll { flex: 1; min-height: 0; overflow-y: auto; }
    .tree { padding: 4px 8px 8px; }
    /* Poignée de largeur : invisible au repos, filet bleu au survol et au focus ; double-clic = largeur d'origine. */
    .split { position: absolute; top: 0; bottom: 0; right: -4px; z-index: 3; width: 7px; cursor: col-resize; touch-action: none; }
    .split::after { content: ''; position: absolute; inset: 0 3px; background: transparent; transition: background-color var(--dur) var(--ease); }
    .split:hover::after, .split:focus-visible::after, .split:active::after { background: var(--brand); }
    .split:focus-visible { outline: none; }

    .row {
      position: relative; display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px 0 calc(8px + var(--depth) * 14px); border-radius: 6px; cursor: pointer;
      color: var(--text-2); font-size: 13px; transition: background-color var(--dur-fast) var(--ease);
    }
    /* Guides d'indentation : un filet par niveau, aligné sur le chevron du dossier parent. */
    .row::before { content: ''; position: absolute; inset: 0 auto 0 14px; width: calc(var(--depth) * 14px); background: repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px 14px); pointer-events: none; }
    .row:hover { background: var(--hover); color: var(--text); }
    .row:active { background: var(--press); }
    .row[aria-selected='true'] { background: var(--brand-bg); color: var(--text); box-shadow: inset 2px 0 0 var(--brand); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .row.ignored { color: var(--faint); cursor: default; }
    .ic { flex: none; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--dur-fast) var(--ease); }
    .ic.open { transform: rotate(90deg); }
    .folder { color: var(--faint); transition: none; }
    .touch { flex: none; display: inline-flex; align-items: center; gap: 2px; color: var(--read); font-size: 11px; }
    .touch.edit { color: var(--cmd); }
    .touch .ic, .ic.touch { width: 12px; height: 12px; }
    .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .st { flex: none; width: 1ch; font-size: 11px; font-weight: 600; text-align: center; color: var(--text-muted); }
    .st[data-st='A'], .st[data-st='?'] { color: var(--ok); }
    .st[data-st='D'] { color: var(--err); }
    .st[data-st='R'] { color: var(--cmd); }
    .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }

    .main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }

    .bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 30px; padding: 0 4px 0 8px; }
    /* Une seule ligne : le chemin se coupe à gauche, le nom du fichier et les actions restent visibles. */
    .crumbs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 0; overflow: hidden; white-space: nowrap; color: var(--text-muted); }
    .crumb { padding: 2px 4px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; }
    .crumb:hover { background: var(--hover); color: var(--text); }
    .crumb:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .sep { flex: none; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; color: var(--faint); }
    .here { padding: 2px 4px; color: var(--text); }
    .actions { flex: none; display: flex; align-items: center; gap: 2px; margin-left: auto; }
    .actions [aria-pressed='true'] { background: var(--brand-bg); color: var(--text); }
    .by { flex: none; display: flex; gap: 8px; white-space: nowrap; color: var(--text-muted); }
    .link { padding: 0; border: 0; background: none; color: var(--brand); font: inherit; cursor: pointer; }
    .link:hover { text-decoration: underline; }
    .link:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 2px; }
    .note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 8px 16px; border-block: 1px solid var(--line); color: var(--err); }
    .md { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px; }
    .empty { margin: 0; padding: 16px; font-size: 13px; color: var(--faint); }
    .side .empty.small { padding: 4px 20px 8px; font-size: 12px; }
    .start { width: min(420px, 100%); margin: 0 auto; padding: 14vh 16px 16px; }
    .start h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
    .start h4 { margin: 24px 0 4px; padding-left: 8px; font-weight: 600; }
    .keys { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; margin: 0; color: var(--text-muted); }
    .keys dd { margin: 0; text-align: right; color: var(--faint); }
    kbd { padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; font-size: 11px; color: var(--text-2); }

    /* Étroit : le panneau latéral devient un tiroir posé sur l'éditeur, ouvert par la barre d'activité. */
    @media (max-width: 820px) {
      .ide { grid-template-columns: var(--act) minmax(0, 1fr); }
      .side { display: none; position: absolute; inset: 0 auto 25px var(--act); z-index: 2; width: min(320px, 80%); box-shadow: 0 8px 24px var(--shadow); }
      .ide.drawer .side { display: flex; }
      .split { display: none; }
    }
  `,
})
export class SessionFilesComponent {
  protected readonly vm = inject(SessionFilesVm);
  private readonly injector = inject(Injector);
  protected readonly BUSY = 'Claude travaille : édition bloquée';
  protected readonly name = base;
  protected readonly PENCIL = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z';
  protected readonly EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
  protected readonly REFRESH = 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5';
  protected readonly WRAP = 'M3 6h18M3 12h15a3 3 0 0 1 0 6h-5m2-2-2 2 2 2M3 18h6';
  protected readonly VIEW_LABEL: Record<SideView, string> = { tree: 'Arbre du projet', search: 'Rechercher dans les fichiers', claude: 'Fichiers touchés par Claude' };
  readonly sessionId = input.required<string>();
  /** Claude ne travaille pas : l'édition est permise (le daemon applique la même règle). */
  readonly idle = input(false);
  private readonly tree = viewChild<ElementRef<HTMLElement>>('tree');
  protected readonly quick = viewChild.required(FilesQuickComponent);
  private readonly search = viewChild(FilesSearchComponent);

  constructor() {
    this.vm.connect(this.sessionId, this.idle);
    // Tiroir sur écran étroit : le VM suit la media query (état actif de la barre d'activité).
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
    if (r === 'quick') this.quick().open();
    // La vue vient peut-être d'apparaître : focus après rendu.
    if (r === 'search') afterNextRender(() => this.search()?.focus(), { injector: this.injector });
  }

  /** Glisser la poignée : la largeur suit le pointeur, mémorisée à chaque pas. */
  protected drag(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement, start = e.clientX, w = this.vm.width();
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => this.vm.resize(w + m.clientX - start);
    el.addEventListener('pointermove', move);
    // lostpointercapture : relâché ou annulé (pointercancel).
    el.addEventListener('lostpointercapture', () => el.removeEventListener('pointermove', move), { once: true });
  }

  protected sizeKey(e: KeyboardEvent): void {
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    this.vm.resize(this.vm.width() + step);
  }

  protected treeKey(e: KeyboardEvent): void {
    if (!this.vm.treeKey(e.key)) return;
    e.preventDefault();
    this.focusRow();
  }

  protected reveal(dir: string): void {
    this.vm.reveal(dir);
    this.focusRow();
  }

  /** Après rendu : focus (et défilement) sur la ligne qui porte le tabindex. */
  private focusRow(): void {
    afterNextRender(() => {
      const path = this.vm.focusRow();
      const el = [...(this.tree()?.nativeElement.querySelectorAll<HTMLElement>('[role=treeitem]') ?? [])].find((r) => r.dataset['path'] === path);
      el?.focus();
      el?.scrollIntoView?.({ block: 'nearest' });
    }, { injector: this.injector });
  }
}
