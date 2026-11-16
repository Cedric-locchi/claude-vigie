import { Service, signal } from '@angular/core';
import { SessionSummary } from './models';

export interface ConfirmRequest {
  title: string;
  message: string;
  action: string;
  danger?: boolean;
}

/** Confirmations de l'app, affichées par <app-confirm-dialog> (alert-dialog spartan) : les VM attendent la réponse. */
@Service()
export class ConfirmService {
  private resolve: ((ok: boolean) => void) | null = null;
  readonly pending = signal<ConfirmRequest | null>(null);

  ask(request: ConfirmRequest): Promise<boolean> {
    this.answer(false); // une seule question à la fois : la précédente vaut « non »
    this.pending.set(request);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  answer(ok: boolean): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.pending.set(null);
    resolve?.(ok);
  }

  deleteSession(s: Pick<SessionSummary, 'title' | 'terminalId'>): Promise<boolean> {
    const terminal = s.terminalId ? ' Ses terminaux seront fermés, et Claude arrêté s’il tourne encore.' : '';
    return this.ask({
      title: `Supprimer « ${s.title} » ?`,
      message: `La session disparaît de Vigie.${terminal} Le transcript reste disponible pour claude --resume.`,
      action: 'Supprimer',
      danger: true,
    });
  }

  deleteSessions(count: number, anyTerminal: boolean): Promise<boolean> {
    const terminal = anyTerminal ? ' Leurs terminaux seront fermés, et Claude arrêté s’il tourne encore.' : '';
    return this.ask({
      title: `Supprimer ${count} session${count > 1 ? 's' : ''} ?`,
      message: `${count > 1 ? 'Elles disparaissent' : 'Elle disparaît'} de Vigie.${terminal} Les transcripts restent disponibles pour claude --resume.`,
      action: 'Supprimer',
      danger: true,
    });
  }

  leaveChat(): Promise<boolean> {
    return this.ask({
      title: 'Quitter la discussion ?',
      message: 'C’est une discussion temporaire : elle sera supprimée définitivement, Claude arrêté et sa conversation effacée du disque.',
      action: 'Quitter et supprimer',
      danger: true,
    });
  }

  commit(total: number, branch: string | null): Promise<boolean> {
    return this.ask({
      title: `Commiter ${total} fichier${total > 1 ? 's' : ''}${branch ? ` sur ${branch}` : ''} ?`,
      message: 'Tous les changements sont indexés (git add -A, .gitignore respecté) puis commités avec ce message. Rien n’est poussé.',
      action: 'Commiter',
    });
  }

  restoreFile(path: string, untracked: boolean): Promise<boolean> {
    return this.ask({
      title: `Annuler les modifications de « ${path} » ?`,
      message: untracked ? 'Ce fichier n’est pas suivi par git : il sera supprimé du disque.' : 'Le fichier revient à son état dans HEAD (modifications indexées comprises). Irréversible.',
      action: untracked ? 'Supprimer le fichier' : 'Annuler les modifications',
      danger: true,
    });
  }

  /** Une session encore ouverte ailleurs écrirait à deux dans le même transcript : on prévient. */
  resumeSession(s: Pick<SessionSummary, 'title' | 'state'>): Promise<boolean> {
    if (s.state === 'done') return Promise.resolve(true);
    return this.ask({
      title: 'Session encore ouverte ailleurs',
      message: `« ${s.title} » semble encore ouverte dans un autre terminal. Quitte-la là-bas d'abord (/exit), sinon deux Claude écriront dans la même session.`,
      action: 'Reprendre quand même',
    });
  }
}
