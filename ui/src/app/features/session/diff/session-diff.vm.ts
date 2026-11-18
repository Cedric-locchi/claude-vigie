import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { form, submit, validateStandardSchema } from '@angular/forms/signals';
import { BranchName, CommitBody } from '@vigie/contract';
import { ConfirmRequest, ConfirmService } from '../../../core/confirm.service';
import { GitFile } from '../../../core/models';
import { VigieService } from '../../../core/vigie.service';
import { keepLast } from '../../../core/signals';

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  old: number | null;
  new: number | null;
}

/** Patch unifié → lignes numérotées ; les en-têtes de fichier (diff --git, index, ---, +++) sont sautés. */
export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let o = 0, n = 0, inHunk = false;
  for (const l of patch.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(l);
    if (h) {
      o = +h[1]; n = +h[2]; inHunk = true;
      out.push({ kind: 'hunk', text: l, old: null, new: null });
    } else if (!inHunk || l.startsWith('\\')) {
      continue;
    } else if (l[0] === '+') out.push({ kind: 'add', text: l.slice(1), old: null, new: n++ });
    else if (l[0] === '-') out.push({ kind: 'del', text: l.slice(1), old: o++, new: null });
    else if (l[0] === ' ') out.push({ kind: 'ctx', text: l.slice(1), old: o++, new: n++ });
  }
  return out;
}

export const STATUS: Record<GitFile['status'], { label: string; hint: string }> = {
  M: { label: 'M', hint: 'Modifié' },
  A: { label: 'A', hint: 'Ajouté' },
  D: { label: 'D', hint: 'Supprimé' },
  R: { label: 'R', hint: 'Renommé' },
  '?': { label: 'U', hint: 'Non suivi' },
};

/** Saisie non enregistrée sur le point d'être remplacée ou abandonnée (partagée avec la garde de sortie de la page). */
export const DISCARD_EDIT: ConfirmRequest = {
  title: 'Abandonner la saisie ?',
  message: 'Tu as modifié ce fichier sans l’enregistrer : ces modifications seront perdues.',
  action: 'Abandonner',
  danger: true,
};

@Injectable()
export class SessionDiffVm {
  private readonly vigie = inject(VigieService);
  private readonly confirm = inject(ConfirmService);
  private readonly source = signal<{ id: Signal<string>; lastTs: Signal<number>; idle: Signal<boolean> } | null>(null);
  private readonly id = computed(() => this.source()?.id() ?? null);
  private readonly version = computed(() => this.source()?.lastTs() ?? 0);
  private readonly resource = this.vigie.gitResource(this.id, this.version);

  /** Garde le dernier diff de la même session pendant un rechargement : pas de clignotement ni de scroll perdu à chaque activité. */
  readonly diff = keepLast(this.resource, this.id);
  readonly failed = computed(() => this.resource.status() === 'error');

  readonly totals = computed(() => (this.diff()?.files ?? []).reduce((t, f) => ({ added: t.added + f.added, removed: t.removed + f.removed }), { added: 0, removed: 0 }));

  /** Fichier affiché ; par défaut le premier. Reste sélectionné au rafraîchissement tant qu'il est modifié. */
  private readonly chosen = signal<string | null>(null);
  readonly file = computed(() => {
    const files = this.diff()?.files ?? [];
    return files.find((f) => f.path === this.chosen()) ?? files[0] ?? null;
  });
  readonly lines = computed(() => (this.file() ? parsePatch(this.file()!.patch) : []));

  /** Claude ne travaille pas (fin de tour ou terminé, aucun sous-agent actif) : même règle que `store.idle` du daemon. */
  readonly idle = computed(() => this.source()?.idle() ?? false);

  connect(id: Signal<string>, lastTs: Signal<number>, idle: Signal<boolean>): void {
    this.source.set({ id, lastTs, idle });
  }

  async select(path: string): Promise<void> {
    if (path === this.file()?.path) return;
    if (this.dirty() && !(await this.confirm.ask(DISCARD_EDIT))) return;
    this.chosen.set(path);
    this.cancelEdit();
  }

  /** Panneau du message de commit : ouvert à la première proposition de Claude. */
  readonly commitOpen = signal(false);
  readonly commitModel = signal({ message: '' });
  /** Même règle que le corps attendu par le daemon (POST …/git/commit) : message non vide. */
  readonly commitForm = form(this.commitModel, (p) => {
    validateStandardSchema(p.message, CommitBody.shape.message);
  });
  readonly generating = signal(false);
  readonly error = signal<string | null>(null);

  async restore(f: GitFile): Promise<void> {
    const id = this.id();
    if (!id || !(await this.confirm.restoreFile(f.path, f.status === '?'))) return;
    await this.run(() => this.vigie.restoreFile(id, f.path));
    this.resource.reload();
  }

  async generateCommitMessage(): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.generating.set(true);
    await this.run(async () => {
      const { message } = await this.vigie.suggestCommitMessage(id);
      this.commitModel.set({ message });
      this.commitOpen.set(true);
    });
    this.generating.set(false);
  }

  readonly committing = signal(false);

  async commit(): Promise<void> {
    const id = this.id(), d = this.diff();
    if (!id || !d) return;
    // submit marque le champ touché et ne lance rien si le message est invalide.
    await submit(this.commitForm, async () => {
      if (!(await this.confirm.commit(d.total, d.branch))) return undefined;
      this.committing.set(true);
      await this.run(async () => {
        await this.vigie.commit(id, this.commitModel().message.trim());
        this.commitOpen.set(false);
      });
      this.committing.set(false);
      this.resource.reload();
      return undefined;
    });
  }

  /** Panneau « Nouvelle branche » : nouvelle branche ici, ou worktree isolé (demandé à Claude par la page). */
  readonly branchOpen = signal(false);
  readonly branchName = signal('');
  /** Message d'erreur du nom saisi ; vide accepté (worktree au nom choisi par Claude). Même règle que le daemon. */
  readonly branchNameError = computed(() => {
    const n = this.branchName().trim();
    if (!n) return null;
    const r = BranchName.safeParse(n);
    return r.success ? null : (r.error.issues[0]?.message ?? 'Nom invalide');
  });
  readonly branching = signal(false);

  async createBranch(): Promise<void> {
    const id = this.id(), name = this.branchName().trim();
    if (!id || !name || this.branchNameError()) return;
    this.branching.set(true);
    await this.run(async () => {
      await this.vigie.createBranch(id, name);
      this.branchOpen.set(false);
      this.branchName.set('');
    });
    this.branching.set(false);
    this.resource.reload();
  }

  // ponytail: <textarea> plutôt qu'un éditeur riche (CodeMirror, Monaco : coloration, recherche) ; à revoir si l'édition devient un usage courant.
  /** Fichier ouvert en édition, avec l'empreinte lue (le daemon refuse l'écriture si le fichier a changé depuis). */
  // `eol` : une <textarea> normalise CRLF en LF ; on remet la fin de ligne du fichier à l'écriture.
  private readonly edit = signal<{ id: string; path: string; hash: string; eol: string; content: string } | null>(null);
  readonly editing = computed(() => {
    const e = this.edit();
    return e && e.id === this.id() && e.path === this.file()?.path ? e : null;
  });
  readonly draft = signal('');
  /** Saisie différente du fichier lu : changer de fichier ou recharger la perdrait (la page garde l'onglet monté et garde sa sortie). */
  readonly dirty = computed(() => {
    const e = this.editing();
    return !!e && this.draft() !== e.content;
  });
  readonly loadingFile = signal(false);
  readonly saving = signal(false);
  /** Le fichier a changé sur le disque depuis sa lecture : l'écriture a été refusée. */
  readonly conflict = signal(false);
  /** Fichier éditable : ni supprimé, avec un patch texte (pas binaire). La taille, c'est le daemon qui la juge (400). */
  readonly editable = computed(() => {
    const f = this.file();
    return !!f && f.status !== 'D' && this.lines().length > 0;
  });

  async startEdit(): Promise<void> {
    if (this.editable() && this.idle()) await this.load();
  }

  /** Relit le fichier depuis le disque (la saisie en cours est remplacée). */
  async load(): Promise<void> {
    const id = this.id(), f = this.file();
    if (!id || !f) return;
    if (this.dirty() && !(await this.confirm.ask(DISCARD_EDIT))) return;
    this.loadingFile.set(true);
    await this.run(async () => {
      const r = await this.vigie.gitFile(id, f.path);
      this.draft.set(r.content);
      this.edit.set({ id, path: f.path, hash: r.hash, eol: r.content.includes('\r\n') ? '\r\n' : '\n', content: r.content });
      this.conflict.set(false);
    });
    this.loadingFile.set(false);
  }

  cancelEdit(): void {
    this.edit.set(null);
    this.conflict.set(false);
  }

  async save(): Promise<void> {
    const e = this.editing();
    if (!e || !this.idle() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.conflict.set(false);
    try {
      await this.vigie.writeFile(e.id, { path: e.path, content: this.draft().replace(/\r?\n/g, e.eol), hash: e.hash });
      this.edit.set(null);
      this.resource.reload();
    } catch (err) {
      const msg = message(err);
      if ((err as { status?: number }).status === 412) this.conflict.set(true); // 412 = empreinte périmée ; 409 = Claude travaille
      else this.error.set(msg);
    }
    this.saving.set(false);
  }

  closeCommit(): void {
    this.commitOpen.set(false);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try { await fn(); } catch (e) { this.error.set(message(e)); }
  }
}

/** Message d'une erreur HTTP du daemon (`{ error }`), sinon de l'exception. */
export const message = (e: unknown): string =>
  (e as { error?: { error?: string } }).error?.error ?? (e instanceof Error ? e.message : 'Le daemon n’a pas répondu.');
