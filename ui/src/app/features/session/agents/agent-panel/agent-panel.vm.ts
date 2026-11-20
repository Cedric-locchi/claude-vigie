import { Injectable, Signal, computed, linkedSignal, signal } from '@angular/core';
import { clipboardCopy } from '../../../../core/clipboard';
import { clockSeconds } from '../../../../core/format';
import { renderMarkdown } from '../../../../core/markdown';
import { Agent, LogEntry } from '../../../../core/models';
import { logFeed } from '../../log/log-feed';

const FEED_MAX = 100;
/** Outils dont l'entrée est du code écrit par l'agent ; les lectures et commandes sont du bruit ici. */
const CODE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** Le code d'un appel d'écriture ; le JSON brut s'il est coupé (4000 caractères côté daemon) et ne se relit plus. */
export function codeOf(e: LogEntry): string {
  try {
    const i = JSON.parse(e.text) as { new_string?: string; content?: string; new_source?: string; edits?: { new_string: string }[] };
    return i.edits?.map((x) => x.new_string).join('\n…\n') ?? i.new_string ?? i.content ?? i.new_source ?? e.text;
  } catch {
    return e.text;
  }
}

/** Message d'un agent : Markdown GFM écrit comme du texte (un retour à la ligne simple compte). */
const md = (text: string) => renderMarkdown(text, { breaks: true });

/** Détail d'un agent : état en direct, dernier message, brief et fil utile tirés du journal de la session. */
@Injectable()
export class AgentPanelVm {
  private readonly source = signal<{ agent: Signal<Agent | null>; sessionId: Signal<string | null> } | null>(null);
  private readonly agent = computed(() => this.source()?.agent() ?? null);

  connect(agent: Signal<Agent | null>, sessionId: Signal<string | null>): void {
    this.source.set({ agent, sessionId });
  }

  /** Dernier agent affiché, gardé pendant l'animation de fermeture. */
  readonly shown = linkedSignal<Agent | null, Agent | null>({ source: this.agent, computation: (agent, previous) => agent ?? previous?.value ?? null });
  /** Texte seul : un snapshot qui ne change pas le message ne relance pas le rendu (jusqu'à 20 000 caractères). */
  private readonly lastText = computed(() => this.shown()?.lastText ?? '');
  /** Dernier message (le rapport, une fois l'agent terminé), en markdown GFM : titres, listes, tableaux, code. */
  readonly html = computed(() => md(this.lastText()));

  private readonly clipboard = clipboardCopy();
  /** « Copié » affiché 1,5 s après la copie du markdown. */
  readonly copied = this.clipboard.copied;

  /** Copie le markdown brut du dernier message dans le presse-papiers. */
  copy(): Promise<void> {
    return this.clipboard.copy(this.lastText());
  }

  /** Clé texte : un snapshot qui ne change rien à l'agent ouvert ne relance pas de requête. */
  private readonly activity = computed(() => { const a = this.agent(); return a ? `${a.id}:${a.lastTs}` : null; });
  /** Journal de la session (tous agents), complété à chaque activité de l'agent ouvert. */
  private readonly log = logFeed(() => {
    const id = this.source()?.sessionId();
    return id && this.activity() ? id : null;
  }, 'Fil indisponible.');
  readonly logError = this.log.error;

  /** Entrées de l'agent ouvert : une entrée du journal a pour id `<agent.id>:<n>`. */
  private readonly own = computed(() => {
    const prefix = `${this.shown()?.id}:`;
    return this.log.entries().filter((e) => e.id.startsWith(prefix));
  });

  /** Brief : la première consigne reçue par un sous-agent (le prompt de l'agent principal). */
  private readonly briefEntry = computed(() => (this.shown()?.sub ? this.own().find((e) => e.kind === 'prompt') : undefined));
  readonly brief = computed(() => {
    const e = this.briefEntry();
    return e ? { html: md(e.text), truncated: e.truncated } : null;
  });

  /** Ce que l'agent dit, les consignes suivantes, le code qu'il écrit et ses erreurs ; le plus récent en haut. */
  readonly feed = computed(() => {
    const brief = this.briefEntry();
    return this.own()
      .filter((e) => e !== brief && (e.kind === 'assistant' || e.kind === 'prompt' || e.kind === 'error' || (e.kind === 'tool' && CODE_TOOLS.has(e.title.split(' · ')[0]))))
      .slice(-FEED_MAX)
      .reverse()
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.kind === 'assistant' ? 'Message' : e.title,
        truncated: e.truncated,
        time: clockSeconds(e.ts),
        html: e.kind === 'assistant' || e.kind === 'prompt' ? md(e.text) : null,
        code: e.kind === 'tool' ? codeOf(e) : e.text,
      }));
  });
}
