import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { LogEntry, LogKind } from '../../../core/models';
import { CLIENT_OS, isShortcut } from '../../../core/platform';
import { VigieService } from '../../../core/vigie.service';

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
  private readonly vigie = inject(VigieService);
  private readonly mac = inject(CLIENT_OS) === 'mac';
  private readonly source = signal<{ id: Signal<string>; lastTs: Signal<number> } | null>(null);

  /** Toutes les lignes reçues, sans doublon (le rafraîchissement redemande la dernière seconde). */
  readonly entries = signal<LogEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Raccourci de la recherche : Cmd+F sur mac, Ctrl+F ailleurs. */
  readonly searchKey = this.mac ? '⌘F' : 'Ctrl+F';

  readonly query = signal('');
  readonly filter = signal<LogFilter>('all');
  /** null : tous les agents. */
  readonly agent = signal<string | null>(null);
  readonly limit = signal(PAGE);
  private readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  private loadedFor: string | null = null;

  constructor() {
    // Session changée : on repart de zéro. Activité nouvelle (lastTs) : on ne demande que la suite.
    effect(() => {
      const src = this.source();
      if (!src) return;
      const id = src.id();
      src.lastTs();
      untracked(() => this.load(id));
    });
  }

  connect(id: Signal<string>, lastTs: Signal<number>): void {
    this.source.set({ id, lastTs });
  }

  private async load(id: string): Promise<void> {
    const fresh = this.loadedFor !== id;
    if (fresh) {
      this.loadedFor = id;
      this.entries.set([]);
      this.loading.set(true);
    }
    const since = fresh ? 0 : (this.entries().at(-1)?.ts ?? 0);
    try {
      const { entries } = await this.vigie.sessionLog(id, since);
      if (this.loadedFor !== id) return; // réponse d'une session quittée entre-temps
      this.error.set(null);
      if (!entries.length) return;
      const known = new Set(this.entries().map((e) => e.id));
      const added = entries.filter((e) => !known.has(e.id));
      if (added.length) this.entries.update((list) => [...list, ...added].sort((a, b) => a.ts - b.ts));
    } catch {
      this.error.set('Journal indisponible : le daemon est-il à jour ? (redémarre-le après une mise à jour)');
    } finally {
      this.loading.set(false);
    }
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
      time: new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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
