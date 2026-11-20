import { Injectable, Signal, computed, inject, linkedSignal, signal } from '@angular/core';
import { clockSeconds } from '../../../core/format';
import { LogKind } from '../../../core/models';
import { CLIENT_OS, isShortcut } from '../../../core/platform';
import { logFeed } from './log-feed';

export type LogFilter = 'all' | 'talk' | 'tools' | 'errors' | 'system';

const FILTER_KINDS: Record<Exclude<LogFilter, 'all'>, LogKind[]> = {
  talk: ['prompt', 'assistant', 'thinking'],
  tools: ['tool', 'result'],
  errors: ['error'],
  system: ['system'],
};
export const KIND_LABELS: Record<LogKind, string> = {
  prompt: 'Ta demande', assistant: 'Message', thinking: 'Réflexion', tool: 'Outil', result: 'Résultat', error: 'Erreur', system: 'Système',
};
const PAGE = 200;
/** Au-delà, une ligne est repliée (sauf si la recherche y trouve quelque chose). */
const LONG = 400;

export interface TextPart { text: string; hit: boolean }

@Injectable()
export class SessionLogVm {
  private readonly mac = inject(CLIENT_OS) === 'mac';
  private readonly source = signal<{ id: Signal<string>; lastTs: Signal<number>; query: Signal<string> } | null>(null);

  /** Session changée : on repart de zéro. Activité nouvelle (lastTs) : on ne demande que la suite. */
  private readonly feed = logFeed(() => {
    const src = this.source();
    src?.lastTs();
    return src?.id() ?? null;
  }, 'Journal indisponible.');
  /** Toutes les lignes reçues, sans doublon, de la plus ancienne à la plus récente. */
  readonly entries = this.feed.entries;
  readonly loading = this.feed.loading;
  readonly error = this.feed.error;

  /** Raccourci de la recherche : Cmd+F sur mac, Ctrl+F ailleurs. */
  readonly searchKey = this.mac ? '⌘F' : 'Ctrl+F';

  /** Recherche : celle imposée par la page (« Voir dans le journal ») tant qu'on ne la retape pas. */
  readonly query = linkedSignal(() => this.source()?.query() ?? '');
  readonly filter = signal<LogFilter>('all');
  /** null : tous les agents. */
  readonly agent = signal<string | null>(null);
  readonly limit = signal(PAGE);
  private readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  connect(id: Signal<string>, lastTs: Signal<number>, query: Signal<string> = signal('')): void {
    this.source.set({ id, lastTs, query });
  }

  readonly agents = computed(() => [...new Set(this.entries().map((e) => e.agent))]);

  private readonly needle = computed(() => this.query().trim().toLowerCase());

  /** Lignes du filtre courant, sans la recherche : sert aux compteurs. */
  private readonly scoped = computed(() => {
    const agent = this.agent();
    return agent ? this.entries().filter((e) => e.agent === agent) : this.entries();
  });

  readonly counts = computed(() => {
    const list = this.scoped();
    const n = (kinds: LogKind[]) => list.filter((e) => kinds.includes(e.kind)).length;
    return { all: list.length, talk: n(FILTER_KINDS.talk), tools: n(FILTER_KINDS.tools), errors: n(FILTER_KINDS.errors), system: n(FILTER_KINDS.system) };
  });

  /** Résultat : filtre + recherche, le plus récent en haut. */
  readonly matches = computed(() => {
    const f = this.filter();
    const q = this.needle();
    const kinds = f === 'all' ? null : FILTER_KINDS[f];
    return this.scoped()
      .filter((e) => (!kinds || kinds.includes(e.kind)) && (!q || `${e.title}\n${e.text}\n${e.agent}`.toLowerCase().includes(q)))
      .reverse();
  });

  readonly visible = computed(() =>
    this.matches().slice(0, this.limit()).map((e) => ({
      ...e,
      time: clockSeconds(e.ts),
      label: KIND_LABELS[e.kind],
      long: e.text.length > LONG || e.text.split('\n').length > 8,
      /** Déplié à la main, ou parce que la recherche trouve quelque chose dans le texte. */
      open: this.expandedIds().has(e.id) || (!!this.needle() && e.text.toLowerCase().includes(this.needle())),
      titleParts: this.parts(e.title),
      textParts: this.parts(e.text),
    })),
  );
  readonly hasMore = computed(() => this.matches().length > this.limit());

  /** Découpe un texte autour des occurrences de la recherche, pour les surligner sans innerHTML. */
  parts(text: string): TextPart[] {
    const q = this.needle();
    if (!q) return [{ text, hit: false }];
    const out: TextPart[] = [];
    const lower = text.toLowerCase();
    let from = 0;
    for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) {
      if (i > from) out.push({ text: text.slice(from, i), hit: false });
      out.push({ text: text.slice(i, i + q.length), hit: true });
      from = i + q.length;
    }
    if (from < text.length) out.push({ text: text.slice(from), hit: false });
    return out;
  }

  setQuery(q: string): void { this.query.set(q); this.limit.set(PAGE); }
  setFilter(f: LogFilter): void { this.filter.set(f); this.limit.set(PAGE); }
  setAgent(agent: string | null): void { this.agent.set(agent || null); this.limit.set(PAGE); }
  more(): void { this.limit.update((n) => n + PAGE); }
  toggle(id: string): void {
    this.expandedIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Hors mac, Ctrl+F tapé dans le terminal lui appartient (caractère suivant pour readline, etc.) : on le laisse passer. */
  isSearchShortcut(e: KeyboardEvent): boolean {
    if (!isShortcut(e, 'f', this.mac)) return false;
    return this.mac || !(e.target instanceof Element && e.target.closest('.xterm'));
  }
}
