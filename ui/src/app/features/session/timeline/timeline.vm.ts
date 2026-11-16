import { keepLast } from '../../../core/signals';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import * as f from '../../../core/format';
import { LogEntry } from '../../../core/models';
import { CLIENT_OS } from '../../../core/platform';
import { VigieService } from '../../../core/vigie.service';
import {
  ALL_KINDS, AxisLabel, GanttBlock, MAX_ZOOM, Scale, StepKind, TraceFilter, TraceRow, allSteps, blockLabel, clusterBars, compressedScale,
  filterRows, gantt, isFiltering, stepPath, thinLabels, turnIntervals, turnRows, zoomAt, zoomTo,
} from './timeline';

/** Largeur supposée du canevas tant qu'il n'est pas mesuré (tests, premier rendu). */
const FALLBACK_WIDTH = 1000;

export interface StepDetail {
  input: string | null;
  output: string | null;
  error: boolean;
  truncated: boolean;
}

@Injectable()
export class TimelineVm {
  private readonly vigie = inject(VigieService);
  private readonly source = signal<{ id: Signal<string>; version: Signal<number> } | null>(null);
  private readonly id = computed(() => this.source()?.id() ?? null);
  private readonly version = computed(() => this.source()?.version() ?? 0);
  private readonly resource = this.vigie.traceResource(this.id, this.version);

  /** Garde la dernière trace pendant un rechargement : pas de clignotement à chaque activité. */
  readonly trace = keepLast(this.resource);
  readonly loading = computed(() => !this.trace() && this.resource.isLoading());
  readonly failed = computed(() => this.resource.status() === 'error' && !this.trace());

  // ── Filtres ──
  readonly kinds = signal<ReadonlySet<StepKind>>(new Set(ALL_KINDS));
  readonly errorsOnly = signal(false);
  readonly query = signal('');
  private readonly filter = computed<TraceFilter>(() => ({ kinds: this.kinds(), errorsOnly: this.errorsOnly(), query: this.query() }));
  readonly filtering = computed(() => isFiltering(this.filter()));

  // ── Dépliage ──
  /** Tours dépliés à la main ; par défaut, le tour en cours (ou le dernier). */
  private readonly openTurns = signal<ReadonlySet<number> | null>(null);
  private readonly openRows = signal<ReadonlySet<string>>(new Set());
  readonly selected = signal<string | null>(null);

  /** Tours prêts à afficher, du plus récent au plus ancien. */
  readonly turns = computed(() => {
    const trace = this.trace();
    if (!trace) return [];
    const filter = this.filter();
    const filtering = this.filtering();
    const open = this.openTurns() ?? this.defaultOpen();
    return trace.turns
      .map((turn) => {
        const now = turn.live ? trace.now : turn.end;
        const scale = compressedScale(turnIntervals(turn, now), turn.start, turn.live ? Math.max(turn.end, trace.now) : turn.end);
        const steps = allSteps(turn);
        const rows = filterRows(turnRows(turn), filter);
        return {
          index: turn.index,
          start: turn.start,
          live: turn.live,
          prompt: turn.prompt,
          time: f.clock(turn.start),
          duration: f.elapsed(scale.active),
          tools: steps.length,
          errors: steps.filter((s) => s.error).length,
          agents: turn.steps.filter((s) => s.agent).length,
          waiting: turn.live && trace.waiting ? trace.waiting : null,
          // En filtrant, les tours qui ont des résultats s'ouvrent d'eux-mêmes.
          open: filtering ? rows.length > 0 : open.has(turn.index),
          rows: this.flatten(rows, scale, now),
          scale,
          axisEnd: f.elapsed(scale.active),
          matches: rows.length,
        };
      })
      .filter((t) => !filtering || t.matches)
      .reverse();
  });

  readonly counts = computed(() => {
    const trace = this.trace();
    const steps = trace ? trace.turns.flatMap(allSteps) : [];
    return { turns: trace?.turns.length ?? 0, steps: steps.length, errors: steps.filter((s) => s.error).length };
  });

  /** Arbre → lignes affichées (enfants des groupes / sous-agents seulement s'ils sont dépliés, ou en filtrant). */
  private flatten(rows: TraceRow[], scale: Scale, now: number): (TraceRow & { left: number; width: number; duration: string; open: boolean; running: boolean })[] {
    const opened = this.openRows();
    const out: ReturnType<TimelineVm['flatten']> = [];
    const walk = (list: TraceRow[]) => {
      for (const row of list) {
        const end = row.end ?? now;
        const left = scale.x(row.start);
        const open = row.children.length > 0 && (opened.has(row.key) || this.filtering());
        out.push({ ...row, left, width: Math.max(0.35, scale.x(end) - left), duration: f.elapsed(end - row.start), open, running: row.end === null });
        if (open) walk(row.children);
      }
    };
    walk(rows);
    return out;
  }

  connect(id: Signal<string>, version: Signal<number>): void {
    this.source.set({ id, version });
  }

  /** Par défaut, seul le dernier tour est déplié. */
  private defaultOpen(): ReadonlySet<number> {
    const last = this.trace()?.turns.at(-1);
    return new Set(last ? [last.index] : []);
  }

  toggleTurn(index: number): void {
    const next = new Set(this.openTurns() ?? this.defaultOpen());
    if (!next.delete(index)) next.add(index);
    this.openTurns.set(next);
  }

  openTurn(index: number): void {
    this.openTurns.update((open) => new Set([...(open ?? this.defaultOpen()), index]));
  }

  toggleRow(key: string): void {
    this.openRows.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  toggleKind(kind: StepKind): void {
    this.kinds.update((kinds) => {
      const next = new Set(kinds);
      if (!next.delete(kind)) next.add(kind);
      return next.size ? next : new Set(ALL_KINDS); // tout décocher = tout voir
    });
  }

  setQuery(q: string): void { this.query.set(q); }
  setErrorsOnly(on: boolean): void { this.errorsOnly.set(on); }
  resetFilters(): void { this.kinds.set(new Set(ALL_KINDS)); this.errorsOnly.set(false); this.query.set(''); }

  // ── Gantt ──
  /** Zoom horizontal (1 = toute la session) et largeur mesurée du canevas à zoom 1, en px. */
  readonly zoom = signal(1);
  readonly ganttWidth = signal(0);
  readonly maxZoom = MAX_ZOOM;
  /** Barre active du Gantt (la seule dans l'ordre de tabulation) et texte du survol / focus. */
  private readonly activeBar = signal<string | null>(null);
  readonly readout = signal<string | null>(null);
  /** Plage en cours de sélection sur l'axe, en fractions du canevas. */
  readonly drag = signal<{ from: number; to: number } | null>(null);
  readonly zoomHint = inject(CLIENT_OS) === 'mac'
    ? 'Pince ou ⌘ + molette pour zoomer, glisse sur l’axe pour choisir une plage'
    : 'Ctrl + molette pour zoomer, glisse sur l’axe pour choisir une plage';

  private readonly viewWidth = computed(() => this.ganttWidth() || FALLBACK_WIDTH);
  private readonly ganttBase = computed(() => {
    const trace = this.trace();
    return trace ? gantt(trace, this.filter()) : null;
  });

  readonly gantt = computed(() => {
    const g = this.ganttBase();
    const trace = this.trace();
    if (!g || !trace) return null;
    const px = (this.viewWidth() * this.zoom()) / 100;
    const lanes = g.lanes.map((lane) => ({
      ...lane,
      blocks: clusterBars(lane.bars, px).map((b) => ({ ...b, aria: blockLabel(b, trace.now), showCount: b.count > 1 && b.width * px >= 22 })),
    }));
    const keys = new Set(lanes.flatMap((l) => l.blocks.map((b) => b.key)));
    const active = this.activeBar();
    const tab = active && keys.has(active) ? active : (lanes[0]?.blocks[0]?.key ?? null);
    // Deux lignes d'axe : repères (tours, maintenant) en haut, coupures « ⋯ 12 min ⋯ » dessous, chacune éclaircie selon la largeur.
    const marks: (AxisLabel & { turn: number | null })[] = [
      ...(g.now !== null ? [{ key: 'now', text: 'maintenant', x: g.now * px, prio: 0, turn: null }] : []),
      ...g.turns.map((t) => ({ key: `t${t.index}`, text: `T${t.index}`, x: t.x * px, prio: 1, turn: t.index })),
    ];
    const gaps = g.scale.breaks.map((b, i) => ({ key: `b${i}`, text: `⋯ ${b.label} ⋯`, x: (b.left + b.width / 2) * px, prio: 2, turn: null }));
    const counts = this.counts();
    const agents = lanes.slice(1).map((l) => l.name);
    const summary = `${counts.turns} tour${counts.turns > 1 ? 's' : ''}, ${counts.steps} étape${counts.steps > 1 ? 's' : ''}`
      + (counts.errors ? ` dont ${counts.errors} en erreur` : '')
      + (agents.length ? `, ${agents.length} sous-agent${agents.length > 1 ? 's' : ''} : ${agents.join(', ')}` : ', aucun sous-agent')
      + `, ${f.elapsed(g.scale.active)} d’activité` + (g.wait ? '. Claude attend une réponse.' : '.');
    return {
      ...g, lanes, tab, summary,
      labels: [...thinLabels(marks, 100 * px), ...thinLabels(gaps, 100 * px)].map((l) => ({ ...l, left: l.x / px, gap: l.prio === 2 })),
      turnTitles: new Map(g.turns.map((t) => [t.index, `Tour ${t.index} · ${f.clock(t.start)} · ${t.prompt || '(sans message)'}`])),
    };
  });

  setGanttWidth(px: number): void { this.ganttWidth.set(Math.max(0, Math.round(px))); }
  resetZoom(): void { this.zoom.set(1); }

  /** Zoome d'un facteur autour d'un point (fraction du canevas sous le pointeur, à `at` px du bord) ; rend le défilement à appliquer. */
  zoomBy(factor: number, anchor: number, at: number): number {
    const v = zoomAt(this.zoom(), factor, anchor, at, this.viewWidth());
    this.zoom.set(v.zoom);
    return v.scrollLeft;
  }

  zoomRange(from: number, to: number): number {
    const v = zoomTo(from, to, this.viewWidth());
    this.zoom.set(v.zoom);
    return v.scrollLeft;
  }

  // Sélection d'une plage en glissant sur l'axe.
  dragStart(at: number): void { this.drag.set({ from: at, to: at }); }
  dragMove(at: number): void { this.drag.update((d) => (d ? { ...d, to: Math.min(1, Math.max(0, at)) } : d)); }
  /** Fin du glissé : zoome sur la plage si elle fait plus de quelques pixels, rend le défilement (ou null). */
  dragEnd(): number | null {
    const d = this.drag();
    this.drag.set(null);
    if (!d || Math.abs(d.to - d.from) * this.viewWidth() * this.zoom() < 6) return null;
    return this.zoomRange(d.from, d.to);
  }

  focusBar(key: string, label: string): void {
    this.activeBar.set(key);
    this.readout.set(label);
  }

  /**
   * Clic sur une barre : un bloc « ×N » zoome sur sa plage (rend le défilement) ; une étape ouvre son tour, déplie
   * ses parents dans la cascade et affiche son détail (rend null). Une étape masquée par les filtres les efface.
   */
  pick(block: GanttBlock): number | null {
    if (block.count > 1) {
      const pad = block.width * 0.1;
      return this.zoomRange((block.left - pad) / 100, (block.left + block.width + pad) / 100);
    }
    const bar = block.bars[0];
    void this.reveal(bar.turn, bar.stepId);
    return null;
  }

  async reveal(turnIndex: number, stepId: string): Promise<void> {
    const turn = this.trace()?.turns.find((t) => t.index === turnIndex);
    if (!turn) return;
    const rows = turnRows(turn);
    if (this.filtering() && !stepPath(filterRows(rows, this.filter()), stepId)) this.resetFilters();
    const path = stepPath(rows, stepId) ?? [];
    this.openTurn(turnIndex);
    this.openRows.update((keys) => new Set([...keys, ...path]));
    if (this.selected() !== stepId) await this.select(stepId);
  }

  // ── Détail d'une étape (paramètres et résultat, repris du journal) ──
  private log: LogEntry[] = [];
  readonly detail = signal<StepDetail | null>(null);
  readonly detailLoading = signal(false);

  async select(stepId: string | null): Promise<void> {
    if (!stepId || this.selected() === stepId) {
      this.selected.set(null);
      return;
    }
    this.selected.set(stepId);
    let entries = this.log.filter((e) => e.ref === stepId);
    // Pas encore dans le journal chargé (étape récente) : on le recharge.
    if (!entries.some((e) => e.kind !== 'tool') && this.id()) {
      this.detailLoading.set(true);
      try {
        this.log = (await this.vigie.sessionLog(this.id()!)).entries;
        entries = this.log.filter((e) => e.ref === stepId);
      } catch { /* détail indisponible : on affiche ce qu'on a */ } finally {
        this.detailLoading.set(false);
      }
    }
    if (this.selected() !== stepId) return;
    const input = entries.find((e) => e.kind === 'tool');
    const output = entries.find((e) => e.kind === 'result' || e.kind === 'error');
    this.detail.set({
      input: input?.text ?? null,
      output: output?.text ?? null,
      error: output?.kind === 'error',
      truncated: !!(input?.truncated || output?.truncated),
    });
  }
}
