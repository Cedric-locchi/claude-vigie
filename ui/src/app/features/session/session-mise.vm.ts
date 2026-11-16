import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { MiseTasks, TerminalBody } from '../../core/models';
import { VigieService } from '../../core/vigie.service';

/** Seules les tâches du projet comptent : les globales (~/.config/mise) suivent l'utilisateur partout. */
export const projectTasks = (m: MiseTasks | null | undefined) => (m?.tasks ?? []).filter((t) => !t.global);

/** Le projet embarque mise : mise est installé et il y a des tâches du projet, ou un message de mise à montrer (config non approuvée…). */
export const hasMise = (m: MiseTasks | null | undefined): boolean => !!m?.available && (!!m.error || projectTasks(m).length > 0);

/** Secteur d'une tâche et son nom court : préfixe avant « : » (`front:build` → front / build) ;
 *  sinon le dossier de son mise.toml (`ui/mise.toml` → ui) ; sinon le projet lui-même. */
export function sectorOf(t: { name: string; source: string }): { sector: string; short: string } {
  const i = t.name.indexOf(':');
  if (i > 0 && i < t.name.length - 1) return { sector: t.name.slice(0, i), short: t.name.slice(i + 1) };
  const parts = t.source.split(/[\\/]/);
  // Une tâche-fichier (.mise/tasks/…, mise-tasks/…) a déjà son sous-dossier dans le nom : seul un mise*.toml désigne un secteur.
  if (!/mise[^\\/]*\.toml$/.test(parts.at(-1) ?? '')) return { sector: PROJECT, short: t.name };
  const dir = parts.slice(0, -1).filter((s) => s && s !== '.' && s !== '~' && !s.startsWith('.'));
  return { sector: dir.at(-1) ?? PROJECT, short: t.name };
}
const PROJECT = 'Projet';

/**
 * Onglet « Tâches mise » : la liste vient de la page (elle décide si l'onglet existe) ;
 * ici on lance une tâche ou `mise trust` dans un nouveau terminal, que la page affiche ensuite.
 */
@Injectable()
export class SessionMiseVm {
  private readonly vigie = inject(VigieService);
  private readonly source = signal<{ id: Signal<string>; mise: Signal<MiseTasks | null>; opened: (terminalId: string) => void } | null>(null);

  private readonly mise = computed(() => this.source()?.mise() ?? null);
  readonly tasks = computed(() => projectTasks(this.mise()));
  readonly search = signal('');
  /** Tâches groupées par secteur, filtrées par la recherche (nom complet ou alias). « Projet » d'abord, puis l'ordre alphabétique. */
  readonly sectors = computed(() => {
    const q = this.search().trim().toLowerCase();
    const groups = new Map<string, { name: string; short: string }[]>();
    for (const t of this.tasks()) {
      if (q && ![t.name, ...t.aliases].some((n) => n.toLowerCase().includes(q))) continue;
      const { sector, short } = sectorOf(t);
      groups.set(sector, [...(groups.get(sector) ?? []), { name: t.name, short }]);
    }
    return [...groups]
      .sort(([a], [b]) => (a === PROJECT ? -1 : b === PROJECT ? 1 : a.localeCompare(b)))
      .map(([name, tasks]) => ({ name, tasks: tasks.sort((a, b) => a.short.localeCompare(b.short)) }));
  });
  readonly untrusted = computed(() => !!this.mise()?.untrusted);
  /** Message de mise (config non approuvée, toml invalide…), affiché tel quel. */
  readonly error = computed(() => this.mise()?.error ?? null);
  /** Un lancement à la fois : les boutons restent inactifs le temps de la requête. */
  readonly launching = signal(false);
  readonly launchError = signal<string | null>(null);

  connect(id: Signal<string>, mise: Signal<MiseTasks | null>, opened: (terminalId: string) => void): void {
    this.source.set({ id, mise, opened });
  }

  run(name: string): Promise<void> {
    return this.launch({ miseTask: name }, 'Impossible de lancer la tâche.');
  }

  /** `mise trust` dans un terminal : l'utilisateur voit ce qu'il approuve ; la liste se recharge quand il revient sur l'onglet. */
  trust(): Promise<void> {
    return this.launch({ miseTrust: true }, 'Impossible de lancer mise trust.');
  }

  private async launch(body: TerminalBody, fallback: string): Promise<void> {
    const src = this.source();
    if (!src || this.launching()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      const term = await this.vigie.openShell(src.id(), body);
      src.opened(term.id);
    } catch (e) {
      this.launchError.set((e as { error?: { error?: string } })?.error?.error ?? fallback);
    } finally {
      this.launching.set(false);
    }
  }
}
