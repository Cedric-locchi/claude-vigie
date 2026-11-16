import { Component, ElementRef, Injector, afterNextRender, inject, input, viewChild } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { CodeEditorComponent } from './code-editor.component';
import { FilesTouchedComponent } from './files-touched.component';
import { Icon } from '../../core/icon.component';
import { SessionFilesVm, base, isDirty } from './session-files.vm';

/** Onglet Fichiers, façon IDE léger : arbre du projet, onglets de fichiers ouverts, éditeur coloré, barre d'état. */
@Component({
  selector: 'app-session-files',
  imports: [Icon, HlmButton, HlmInput, HlmTooltip, CodeEditorComponent, FilesTouchedComponent],
  providers: [SessionFilesVm],
  host: { '(document:keydown)': 'shortcut($event)' },
  template: `
    @let p = vm.project();
    @let a = vm.active();
    <div class="ide" [class.drawer]="vm.drawer()">
      <aside class="side" id="files-side" aria-label="Arbre du projet">
        <div class="side-head">
          @if (vm.listError(); as e) {
            <span class="text-err small" role="alert">{{ e }}</span>
          } @else if (!p) {
            <span class="small faint">Lecture du projet…</span>
          } @else {
            <span class="root mono small" [hlmTooltip]="p.root" [showDelay]="500">{{ name(p.root) }}</span>
            <span class="small faint">{{ vm.files().length }} fichier{{ vm.files().length > 1 ? 's' : '' }}</span>
          }
          <button hlmBtn variant="ghost" size="icon-sm" class="refresh" aria-label="Rafraîchir l’arbre et le fichier" [disabled]="vm.loading()" (click)="vm.refresh()">
            <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
          </button>
        </div>
        @let touched = vm.touched();
        <button type="button" class="sec" [attr.aria-expanded]="vm.touchedOpen()" aria-controls="files-touched" (click)="vm.touchedOpen.set(!vm.touchedOpen())">
          <svg appIcon="chevron" class="ic" [class.open]="vm.touchedOpen()"></svg>
          Touchés par Claude<span class="mono faint">{{ touched.length }}</span>
        </button>
        <div id="files-touched" class="touched" [hidden]="!vm.touchedOpen()">
          @if (touched.length) { <app-files-touched /> }
          @else { <p class="empty small">Claude n’a encore ouvert aucun fichier dans cette session.</p> }
        </div>
        <p class="sec label">Projet</p>
        <input #filter hlmInput type="search" class="filter" [placeholder]="'Filtrer (' + vm.keys.mod + 'P)'" aria-label="Filtrer les fichiers par chemin"
          [attr.aria-keyshortcuts]="vm.keys.aria + '+P'" autocomplete="off" spellcheck="false" [value]="vm.query()" (input)="vm.query.set($any($event.target).value)" />
        @if (p?.truncated) { <p class="warn small" role="status">Plus de 20 000 entrées : la liste est incomplète.</p> }
        @let t = vm.view();
        @let ch = vm.changes();
        <div #tree class="tree" role="tree" aria-label="Fichiers du projet" (keydown)="treeKey($event)">
          @for (r of t.rows; track r.path) {
            @let tc = vm.touchedByPath().get(r.path);
            @let ed = vm.editedDirs().get(r.path);
            <div role="treeitem" class="row" [class.ignored]="r.kind === 'ignored'" [style.--depth]="r.depth" [attr.data-path]="r.path"
              [attr.tabindex]="r.path === vm.focusRow() ? 0 : -1" [attr.aria-level]="r.depth + 1"
              [attr.aria-expanded]="r.kind === 'dir' ? r.open : null" [attr.aria-selected]="r.kind === 'file' ? a?.path === r.path : null"
              [attr.aria-disabled]="r.kind === 'ignored' || null" (click)="vm.pick(r)">
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
      </aside>

      <section class="main" aria-label="Fichiers ouverts">
        <div class="tabs">
          <button hlmBtn variant="ghost" size="sm" class="drawer-btn" aria-controls="files-side" [attr.aria-expanded]="vm.drawer()" (click)="vm.drawer.set(!vm.drawer())">Fichiers</button>
          @for (tab of vm.tabs(); track tab.path) {
            <div class="tab" [class.on]="tab.path === a?.path" (auxclick)="$event.button === 1 && vm.close(tab.path)" (mousedown)="$event.button === 1 && $event.preventDefault()">
              <button type="button" class="tab-name mono" [attr.aria-current]="tab.path === a?.path ? 'page' : null" [hlmTooltip]="tab.path" [showDelay]="500" (click)="vm.activate(tab.path)">
                {{ name(tab.path) }}@if (dirty(tab)) { <span class="dot" aria-hidden="true"></span><span class="sr-only">, modifié</span> }
              </button>
              <button type="button" class="tab-x" [attr.aria-label]="'Fermer ' + name(tab.path)" (click)="vm.close(tab.path)">
                <svg appIcon="close" class="ic"></svg>
              </button>
            </div>
          }
        </div>

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
              @if (!vm.markdown()) {
                <button hlmBtn variant="outline" size="sm" [attr.aria-pressed]="vm.wrap()" (click)="vm.toggleWrap()" hlmTooltip="Les lignes longues passent à la ligne (sans numéros de ligne)" [showDelay]="500">Retour à la ligne</button>
              }
              @if (vm.editing()) {
                <button hlmBtn variant="ghost" size="sm" (click)="vm.cancelEdit()">Annuler</button>
                <button hlmBtn size="sm" [disabled]="!vm.idle() || vm.saving()" [attr.aria-keyshortcuts]="vm.keys.aria + '+S'" (click)="vm.save()" [hlmTooltip]="vm.idle() ? 'Écrit le fichier sur le disque (' + vm.keys.mod + 'S)' : BUSY">{{ vm.saving() ? 'Enregistrement…' : 'Enregistrer' }}</button>
              } @else if (a.body) {
                @if (vm.isMd()) {
                  <button hlmBtn variant="ghost" size="sm" [attr.aria-pressed]="!vm.showSource()" (click)="vm.showSource.set(!vm.showSource())">Aperçu</button>
                }
                <button hlmBtn variant="outline" size="sm" [disabled]="!vm.idle() || vm.loadingFile()" (click)="vm.startEdit()" [hlmTooltip]="vm.idle() ? 'Modifier ce fichier à la main' : BUSY">{{ vm.loadingFile() ? 'Lecture…' : 'Éditer' }}</button>
              }
            </div>
          </div>
          @if (a.error; as e) { <p class="note small" role="alert">{{ e }}</p> }
          @if (vm.error(); as e) { <p class="note small" role="alert">{{ e }}</p> }
          @if (vm.editing()) {
            @if (a.conflict) {
              <p class="note small" role="alert">Le fichier a changé sur le disque depuis que tu l'as ouvert. Recharger remplace ta saisie par sa version actuelle.
                <button hlmBtn variant="outline" size="sm" [disabled]="vm.loadingFile()" (click)="vm.load()">Recharger</button></p>
            } @else if (!vm.idle()) {
              <p class="note small faint" role="status">{{ BUSY }}. Ta saisie est conservée.</p>
            }
          }
          @if (vm.markdown(); as md) {
            <!-- [innerHTML] passe par le sanitizer d'Angular (scripts et handlers retirés). -->
            <div class="markdown md" [innerHTML]="md"></div>
          } @else if (a.body) {
            <app-code-editor [value]="vm.text()" [path]="a.path" [readonly]="!vm.editing()" [marks]="vm.marks()" [line]="vm.position().line" [wrap]="vm.wrap()"
              [label]="'Contenu de ' + a.path" [help]="vm.help()" (edit)="vm.edit($event)" (caret)="vm.caret.set($event)" />
          } @else if (!a.error) {
            <p class="empty">Lecture…</p>
          }
          @if (vm.status(); as s) {
            <div class="status mono">
              <span>{{ s.lang ?? 'Texte brut' }}</span>
              <span>{{ s.lines }} ligne{{ s.lines > 1 ? 's' : '' }}</span>
              <span>Ln {{ vm.position().line }}, Col {{ vm.position().col }}</span>
              <span>{{ s.eol }}</span>
              @if (vm.dirty()) { <span class="on">modifié</span> }
              @if (!vm.idle()) { <span>lecture seule : Claude travaille</span> }
            </div>
          }
        } @else {
          <div class="start">
            <h3>Ouvre un fichier</h3>
            <p class="small faint">Dans l’arbre, ou cherche-le par son chemin avec <kbd class="mono">{{ vm.keys.mod }}P</kbd>.</p>
            @if (vm.touched().length) {
              <p class="sec label">Derniers touchés par Claude</p>
              <app-files-touched [limit]="5" label="Derniers fichiers touchés par Claude" />
            }
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .ide { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: 288px minmax(0, 1fr); border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
    .side { min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: var(--surface); }
    .side-head { flex: none; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 4px 0 12px; }
    .root { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .refresh { margin-left: auto; }
    .warn { margin: 0 12px; color: var(--text-muted); }
    .filter { flex: none; margin: 0 8px 4px; width: auto; height: 32px; }
    .sec { flex: none; display: flex; align-items: center; gap: 6px; margin: 4px 0 0; padding: 4px 16px 4px 12px; border: 0; background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; text-align: left; }
    button.sec { cursor: pointer; }
    button.sec:hover { color: var(--text); }
    .sec:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .sec .mono { margin-left: auto; letter-spacing: 0; }
    .label { padding-left: 16px; }
    .touched { flex: none; max-height: 34%; overflow-y: auto; border-bottom: 1px solid var(--line); }
    .tree { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 8px; }
    .row {
      position: relative; display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px 0 calc(8px + var(--depth) * 14px); border-radius: 6px; cursor: pointer;
      color: var(--text-2); font-size: 13px; transition: background-color var(--dur-fast) var(--ease);
    }
    /* Guides d'indentation : un filet par niveau, aligné sur le chevron du dossier parent. */
    .row::before { content: ''; position: absolute; inset: 0 auto 0 14px; width: calc(var(--depth) * 14px); background: repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px 14px); pointer-events: none; }
    .row:hover { background: var(--hover); color: var(--text); }
    .row:active { background: var(--press); }
    .row[aria-selected='true'] { background: var(--brand-bg); color: var(--brand); font-weight: 600; box-shadow: inset 2px 0 0 var(--brand); }
    .row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .row.ignored { color: var(--faint); cursor: default; }
    .ic { flex: none; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--dur-fast) var(--ease); }
    .ic.open { transform: rotate(90deg); }
    .folder { color: var(--faint); transition: none; }
    .touch { flex: none; display: inline-flex; align-items: center; gap: 2px; color: var(--read); font-size: 11px; }
    .touch.edit { color: var(--cmd); }
    .touch .ic, .ic.touch { width: 12px; height: 12px; }
    .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .st { flex: none; font-size: 11px; font-weight: 600; color: var(--text-muted); }
    .st[data-st='A'], .st[data-st='?'] { color: var(--ok); }
    .st[data-st='D'] { color: var(--err); }
    .st[data-st='R'] { color: var(--cmd); }
    .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }

    .main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .tabs { flex: none; display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: thin; border-bottom: 1px solid var(--line); background: var(--bg); }
    .drawer-btn { display: none; align-self: center; margin: 0 4px; }
    .tab { flex: none; display: flex; align-items: center; border-right: 1px solid var(--line); color: var(--text-muted); transition: background-color var(--dur-fast) var(--ease); }
    .tab:hover { background: var(--hover); color: var(--text); }
    .tab.on { background: var(--surface); color: var(--text); box-shadow: inset 0 2px 0 var(--brand); }
    .tab-name { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 4px 0 12px; border: 0; background: none; color: inherit; font-size: 12px; }
    .tab-name .dot { background: var(--text); }
    .tab-x { display: grid; place-items: center; width: 24px; height: 24px; margin-right: 6px; border: 0; border-radius: 4px; background: none; color: var(--faint); }
    .tab-x:hover { background: var(--press); color: var(--text); }
    .tab-x .ic { width: 12px; height: 12px; }
    :is(.tab-name, .tab-x, .crumb):focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

    .bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 4px 8px 4px 12px; border-bottom: 1px solid var(--line); }
    /* Une seule ligne : le chemin se coupe à gauche, le nom du fichier et les actions restent visibles. */
    .crumbs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 2px; overflow: hidden; white-space: nowrap; color: var(--text-muted); }
    .crumb { padding: 2px 4px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; }
    .crumb:hover { background: var(--hover); color: var(--text); }
    .sep { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; color: var(--faint); }
    .here { padding: 2px 4px; color: var(--text); }
    .actions { flex: none; display: flex; gap: 4px; margin-left: auto; }
    .by { flex: none; display: flex; gap: 8px; white-space: nowrap; color: var(--text-muted); }
    .actions [aria-pressed='true'] { background: var(--brand-bg); color: var(--text); }
    .link { padding: 0; border: 0; background: none; color: var(--brand); font: inherit; cursor: pointer; }
    .link:hover { text-decoration: underline; }
    .link:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 2px; }
    .note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--line); color: var(--err); }
    .note.faint { color: var(--faint); }
    .md { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px; }
    .status { flex: none; display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 4px 12px; border-top: 1px solid var(--line); font-size: 11px; color: var(--faint); }
    .status .on { color: var(--text); }
    .empty { margin: 0; padding: 16px; font-size: 13px; color: var(--faint); }
    .touched .empty { padding: 4px 16px 8px; font-size: 12px; }
    .start { width: min(480px, 100%); margin: 0 auto; padding: 15vh 16px 16px; }
    .start h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
    .start .sec { margin-top: 16px; padding-left: 16px; }
    kbd { padding: 1px 4px; border: 1px solid var(--line); border-radius: 4px; font-size: 11px; }

    /* Étroit : l'arbre devient un tiroir posé sur l'éditeur, ouvert par « Fichiers ». */
    @media (max-width: 820px) {
      .ide { grid-template-columns: minmax(0, 1fr); }
      .side { display: none; position: absolute; inset: 0 auto 0 0; z-index: 2; width: min(320px, 85%); box-shadow: 0 8px 24px var(--shadow); }
      .ide.drawer .side { display: flex; }
      .drawer-btn { display: inline-flex; }
      .tab-name { padding-left: 8px; }
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
  protected readonly dirty = isDirty;
  readonly sessionId = input.required<string>();
  /** Claude ne travaille pas : l'édition est permise (le daemon applique la même règle). */
  readonly idle = input(false);
  private readonly filter = viewChild<ElementRef<HTMLInputElement>>('filter');
  private readonly tree = viewChild<ElementRef<HTMLElement>>('tree');

  constructor() {
    this.vm.connect(this.sessionId, this.idle);
  }

  protected shortcut(e: KeyboardEvent): void {
    if (this.vm.shortcut(e) === 'filter') afterNextRender(() => this.filter()?.nativeElement.focus(), { injector: this.injector });
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
