import { Component, computed, inject, input, output } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { FileIconComponent } from '../../../core/file-icon.component';
import { SessionDiffVm, STATUS } from './session-diff.vm';

/** Onglet Diff : fichiers modifiés par rapport à HEAD à gauche, patch du fichier choisi à droite. Rechargé à l'ouverture de l'onglet et à chaque activité ; annulation par fichier et message de commit proposé par Claude. */
@Component({
  selector: 'app-session-diff',
  imports: [FormField, HlmButton, HlmInput, HlmTooltip, FileIconComponent],
  providers: [SessionDiffVm],
  template: `
    @let d = vm.diff();
    <div class="diff-head">
      <div class="summary">
        @if (!d) {
          <span role="status">{{ vm.loadError() ?? 'Lecture du dépôt…' }}</span>
        } @else if (!d.repo) {
          <span class="muted">Le dossier de la session n'est pas un dépôt git.</span>
        } @else {
          @if (d.branch) { <span class="mono branch" [hlmTooltip]="d.branch" [showDelay]="500">{{ d.branch }}</span> }
          <span>{{ d.total }} fichier{{ d.total > 1 ? 's' : '' }} modifié{{ d.total > 1 ? 's' : '' }}</span>
          @let t = vm.totals();
          <span class="mono small"><span class="add">+{{ t.added }}</span> <span class="del">−{{ t.removed }}</span></span>
          <span class="where mono small faint" [hlmTooltip]="'Comparé à HEAD dans ' + d.root">{{ d.root }}</span>
        }
      </div>
      <div class="head-actions">
        @if (d?.repo) {
          <button hlmBtn variant="outline" size="sm" [attr.aria-expanded]="vm.branchOpen()" (click)="vm.branchOpen.set(!vm.branchOpen())">Nouvelle branche…</button>
        }
        @if (d?.files?.length) {
          <button hlmBtn variant="outline" size="sm" [disabled]="vm.generating()" (click)="vm.generateCommitMessage()">{{ vm.generating() ? 'Rédaction…' : 'Message de commit' }}</button>
        }
      </div>
    </div>
    @if (vm.branchOpen() && d?.repo) {
      <form class="branch-panel" (submit)="$event.preventDefault(); vm.createBranch()">
        <input hlmInput class="mono" aria-label="Nom de la branche ou du worktree" placeholder="feat/ma-branche" autocomplete="off" spellcheck="false"
          [value]="vm.branchName()" (input)="vm.branchName.set($any($event.target).value)" [attr.aria-invalid]="!!vm.branchNameError()" />
        <button hlmBtn size="sm" type="submit" [disabled]="vm.branching() || !vm.branchName().trim() || !!vm.branchNameError()"
          [hlmTooltip]="'git switch -c dans ' + d!.root + ' : les modifs non commitées suivent'">{{ vm.branching() ? 'Création…' : 'Nouvelle branche ici' }}</button>
        <button hlmBtn variant="outline" size="sm" type="button" [disabled]="!canWorktree() || !!vm.branchNameError()" (click)="askWorktree()"
          [hlmTooltip]="canWorktree() ? 'Demande à Claude de continuer dans un worktree isolé. Les modifs non commitées restent ici.' : 'Indisponible sans terminal claude ouvert par Vigie, ou pendant une demande d’autorisation'">Worktree isolé</button>
        <button hlmBtn variant="ghost" size="sm" type="button" (click)="vm.branchOpen.set(false)">Fermer</button>
        @if (vm.branchNameError(); as err) { <span class="small text-err" role="alert">{{ err }}</span> }
      </form>
    }
    @if (vm.error(); as e) { <p class="error small" role="alert">{{ e }}</p> }
    @if (vm.commitOpen()) {
      <div class="commit">
        <textarea class="mono" rows="5" aria-label="Message de commit proposé" [formField]="vm.commitForm.message" [attr.aria-invalid]="messageInvalid()"></textarea>
        <div class="commit-actions">
          @if (messageInvalid()) { <span class="small text-err" role="alert">Écris un message</span> }
          <button hlmBtn variant="ghost" size="sm" aria-live="polite" (click)="vm.copyMessage()">{{ vm.copied() ? 'Copié' : 'Copier' }}</button>
          <button hlmBtn variant="ghost" size="sm" [disabled]="vm.generating()" (click)="vm.generateCommitMessage()">Régénérer</button>
          <button hlmBtn variant="ghost" size="sm" (click)="vm.closeCommit()">Fermer</button>
          <button hlmBtn size="sm" [disabled]="vm.committing() || vm.generating() || vm.commitForm.message().invalid()" (click)="vm.commit()">{{ vm.committing() ? 'Commit…' : 'Commiter' }}</button>
        </div>
      </div>
    }

    @if (d?.repo) {
      @if (d!.files.length) {
        <div class="body">
          <nav class="files panel" aria-label="Fichiers modifiés">
            @for (f of d!.files; track f.path) {
              <button type="button" class="file" [attr.aria-current]="vm.file().path === f.path ? 'page' : null" (click)="vm.select(f.path)" [hlmTooltip]="(f.from ? f.from + ' → ' : '') + f.path" [showDelay]="500">
                <span class="st mono" [attr.data-st]="f.status"><span aria-hidden="true">{{ STATUS[f.status].label }}</span><span class="sr-only">{{ STATUS[f.status].hint }}</span></span>
                <app-file-icon [name]="f.path" />
                <span class="name"><span class="base">{{ base(f.path) }}</span><span class="dir mono">{{ dir(f.path) }}</span></span>
                <span class="nums mono"><span class="add">+{{ f.added }}</span> <span class="del">−{{ f.removed }}</span></span>
              </button>
            }
            @if (d!.total > d!.files.length) { <p class="small faint more">+ {{ d!.total - d!.files.length }} autres fichiers non affichés</p> }
          </nav>
          <section class="pane panel" aria-label="Différences du fichier">
            @if (vm.file(); as f) {
              <div class="pane-head">
                <div class="pane-title">
                  <span class="mono">{{ f.from ? f.from + ' → ' : '' }}{{ f.path }}</span>
                  <span class="small faint">{{ STATUS[f.status].hint }}@if (f.staged && f.unstaged) { · en partie indexé } @else if (f.staged) { · indexé }</span>
                </div>
                <div class="pane-actions">
                  @if (vm.editing()) {
                    <button hlmBtn variant="ghost" size="sm" (click)="vm.cancelEdit()">Annuler</button>
                    <button hlmBtn size="sm" [disabled]="!vm.idle() || vm.saving()" (click)="vm.save()" [hlmTooltip]="vm.idle() ? 'Écrit le fichier sur le disque' : BUSY">{{ vm.saving() ? 'Enregistrement…' : 'Enregistrer' }}</button>
                  } @else {
                    @if (vm.editable()) {
                      <button hlmBtn variant="outline" size="sm" [disabled]="!vm.idle() || vm.loadingFile()" (click)="vm.startEdit()" [hlmTooltip]="vm.idle() ? 'Modifier ce fichier à la main' : BUSY">{{ vm.loadingFile() ? 'Lecture…' : 'Éditer' }}</button>
                    }
                    <button hlmBtn variant="ghost" size="sm" class="revert" (click)="vm.restore(f)">{{ f.status === '?' ? 'Supprimer le fichier' : 'Restaurer le fichier' }}</button>
                  }
                </div>
              </div>
              @if (vm.editing()) {
                @if (vm.conflict()) {
                  <p class="note small" role="alert">Le fichier a changé sur le disque depuis que tu l'as ouvert. Recharger remplace ta saisie par sa version actuelle.
                    <button hlmBtn variant="outline" size="sm" [disabled]="vm.loadingFile()" (click)="vm.load()">Recharger</button></p>
                } @else if (!vm.idle()) {
                  <p class="note small faint" role="status">{{ BUSY }}. Ta saisie est conservée.</p>
                }
                <textarea class="mono edit" wrap="off" spellcheck="false" autocomplete="off" [attr.aria-label]="'Contenu de ' + f.path"
                  [value]="vm.draft()" (input)="vm.draft.set($any($event.target).value)"></textarea>
              } @else if (vm.lines().length) {
                <div class="code" role="table" aria-label="Patch">
                  @for (l of vm.lines(); track $index) {
                    <div class="ln" [attr.data-k]="l.kind" role="row">
                      @if (l.kind === 'hunk') {
                        <span class="hunk" role="cell">{{ l.text }}</span>
                      } @else {
                        <span class="no" role="cell">{{ l.old ?? '' }}</span><span class="no" role="cell">{{ l.new ?? '' }}</span>
                        <span class="sign" role="cell" aria-hidden="true">{{ l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' ' }}</span><span class="txt" role="cell">{{ l.text }}</span>
                      }
                    </div>
                  }
                </div>
                @if (f.truncated) { <p class="small faint">Patch coupé : fichier trop gros pour être affiché en entier.</p> }
              } @else {
                <p class="empty">Pas de différence texte à afficher (fichier binaire, vide ou simple changement de droits).</p>
              }
            }
          </section>
        </div>
      } @else {
        <p class="clean">Arbre propre : rien à commiter.</p>
      }
    }
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
    .diff-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .head-actions { display: flex; gap: 8px; }
    .branch-panel { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .branch-panel input { width: 240px; }
    .summary { display: flex; align-items: center; gap: 12px; min-width: 0; font-weight: 500; }
    .branch { min-width: 0; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: 999px; background: var(--brand-bg); color: var(--brand); font-size: 12px; }
    .where { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
    .add { color: var(--ok); } .del { color: var(--err); }

    /* Deux panneaux séparés sur le fond pointillé (décision 043) : liste des fichiers, patch ; chacun défile seul. */
    .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 10px; }
    /* relative : les libellés sr-only (absolus) restent dans la liste au lieu d'agrandir la page. */
    .files { position: relative; display: flex; flex-direction: column; gap: 1px; padding: 8px; overflow-y: auto; }
    .file {
      display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent;
      color: var(--text-2); font: inherit; font-size: 13px; text-align: start; transition: background-color var(--dur-fast) var(--ease);
    }
    .file:hover { background: var(--hover); color: var(--text); }
    .file[aria-current='page'] { background: var(--brand-bg); color: var(--text); box-shadow: inset 2px 0 0 var(--brand); }
    .file:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .st { flex: none; width: 1.4em; text-align: center; font-size: 11px; font-weight: 600; color: var(--text-muted); }
    .st[data-st='A'], .st[data-st='?'] { color: var(--ok); }
    .st[data-st='D'] { color: var(--err); }
    .st[data-st='R'] { color: var(--text-2); }
    .name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .base, .dir { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dir { font-size: 11px; color: var(--faint); direction: rtl; text-align: left; }
    .nums { flex: none; font-size: 11px; }
    .more { padding: 6px 8px; margin: 0; }

    .pane { position: relative; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; }
    .pane-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
    .pane-title { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pane-actions { flex: none; display: flex; gap: 4px; }
    .revert { color: var(--err); }
    .note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--line); color: var(--err); }
    .note.faint { color: var(--faint); }
    .edit { flex: 1; min-height: 240px; resize: none; padding: 12px 16px; border: 0; background: var(--surface); color: var(--text); font-size: 12px; line-height: 1.55; white-space: pre; tab-size: 2; }
    .edit:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .error { margin: 0; color: var(--err); }
    .commit { flex: none; display: flex; flex-direction: column; gap: 4px; }
    .commit textarea { width: 100%; resize: vertical; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; line-height: 1.5; }
    .commit textarea:focus-visible { outline: 2px solid var(--brand); outline-offset: -1px; }
    .commit-actions { display: flex; justify-content: flex-end; align-items: center; gap: 4px; }
    .commit-actions .text-err { margin-inline-end: auto; }
    .code { font-family: var(--mono); font-size: 12px; line-height: 1.55; min-width: max-content; padding-bottom: 12px; }
    .ln { display: grid; grid-template-columns: 4.5ch 4.5ch 2ch auto; white-space: pre; }
    .ln[data-k='add'] { background: var(--ok-bg); }
    .ln[data-k='del'] { background: var(--err-bg); }
    .ln[data-k='hunk'] { display: block; margin-top: 8px; padding: 2px 16px; background: var(--brand-bg); color: var(--faint); }
    .no { text-align: right; padding-inline-end: 1ch; color: var(--faint); user-select: none; }
    .sign { text-align: center; user-select: none; color: var(--faint); }
    .ln[data-k='add'] .sign { color: var(--ok); }
    .ln[data-k='del'] .sign { color: var(--err); }
    .txt { padding-inline-end: 16px; color: var(--text-2); }
    .empty, .clean { margin: 0; padding: 16px; font-size: 13px; color: var(--faint); }
    .clean { color: var(--ok); padding: 0; }

    @media (max-width: 820px) {
      .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 35%) minmax(0, 1fr); }
      .where { display: none; }
    }
    /* Téléphone : le document défile seul ; la liste s'allonge, le patch ne défile que sur le côté. */
    @media (max-width: 720px) {
      .body { grid-template-rows: auto auto; }
      .files { overflow: visible; }
      .pane { overflow: auto hidden; }
    }
  `,
})
export class SessionDiffComponent {
  protected readonly vm = inject(SessionDiffVm);
  protected readonly STATUS = STATUS;
  protected readonly BUSY = 'Claude travaille : édition bloquée';
  readonly sessionId = input.required<string>();
  readonly lastTs = input.required<number>();
  /** Claude ne travaille pas : l'édition d'un fichier est permise (le daemon applique la même règle). */
  readonly idle = input(false);
  /** Saisie non enregistrée (lue par la page) : elle garde cet onglet monté et demande confirmation avant de quitter. */
  readonly unsaved = this.vm.dirty;
  /** Claude tourne dans un terminal Vigie et n'attend pas de réponse : on peut lui taper la demande de worktree. */
  readonly canWorktree = input(false);
  /** Nom du worktree (vide : choisi par Claude) ; la page le tape dans le terminal claude. */
  readonly worktree = output<string>();

  protected askWorktree(): void {
    this.worktree.emit(this.vm.branchName().trim());
    this.vm.branchOpen.set(false);
    this.vm.branchName.set('');
  }

  constructor() {
    this.vm.connect(this.sessionId, this.lastTs, this.idle);
  }

  /** Message vidé à la main : erreur affichée dès que le champ a été touché. */
  protected readonly messageInvalid = computed(() => this.vm.commitForm.message().touched() && this.vm.commitForm.message().invalid());

  protected base(p: string): string {
    return p.slice(p.lastIndexOf('/') + 1);
  }

  protected dir(p: string): string {
    return p.slice(0, Math.max(0, p.lastIndexOf('/')));
  }
}
