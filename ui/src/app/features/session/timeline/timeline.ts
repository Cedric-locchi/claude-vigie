// Chronologie : logique pure (échelle de temps compressée, regroupement des étapes, filtres, Gantt en couloirs, zoom).
import * as f from '../../../core/format';
import { SessionTrace, TraceAgent, TraceStep, TraceTurn } from '../../../core/models';

export type StepKind = TraceStep['kind'];
export const KIND_LABELS: Record<StepKind, string> = { read: 'Lecture', edit: 'Édition', command: 'Commande', agent: 'Agent', other: 'Autre' };

/** Au-delà de ce silence, le temps est coupé et remplacé par une coupure « ⋯ 3 h ⋯ ». */
export const GAP = 120_000;
/** Appels successifs du même outil fusionnés en « Read ×6 » s'ils se suivent à moins de ça. */
const MERGE_GAP = 30_000;

// ── Échelle compressée ───────────────────────────────────────────────────

export interface Scale {
  /** Position en % (0–100) d'un instant. */
  x: (t: number) => number;
  breaks: { left: number; width: number; label: string }[];
  /** Durée réellement active (hors coupures). */
  active: number;
}

/**
 * Échelle de temps où les silences de plus de GAP sont réduits à une coupure fixe :
 * l'activité reste lisible même quand un tour s'étale sur des heures.
 */
export function compressedScale(intervals: [number, number][], start: number, end: number, gap = GAP): Scale {
  end = Math.max(end, start + 1);
  const sorted = intervals.map(([a, b]) => [Math.max(start, a), Math.min(end, Math.max(a, b))] as [number, number]).sort((p, q) => p[0] - q[0]);
  // Plages actives : début → fin, fusionnées tant que le silence reste sous `gap`.
  const spans: [number, number][] = [];
  for (const [a, b] of [[start, start] as [number, number], ...sorted, [end, end] as [number, number]]) {
    const last = spans.at(-1);
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  const silences = spans.slice(1).map((s, i) => [spans[i][1], s[0]] as [number, number]);
  const active = spans.reduce((n, [a, b]) => n + Math.max(b - a, 1), 0);
  const breakWidth = silences.length ? Math.min(6, 24 / silences.length) : 0;
  const activeWidth = 100 - breakWidth * silences.length;
  // Segments consécutifs : plage, coupure, plage…
  const segments: { from: number; to: number; left: number; width: number }[] = [];
  let left = 0;
  spans.forEach(([a, b], i) => {
    const width = (Math.max(b - a, 1) / active) * activeWidth;
    segments.push({ from: a, to: b, left, width });
    left += width;
    const s = silences[i];
    if (s) { segments.push({ from: s[0], to: s[1], left, width: breakWidth }); left += breakWidth; }
  });
  const x = (t: number) => {
    const seg = segments.find((g) => t <= g.to) ?? segments.at(-1)!;
    const ratio = seg.to > seg.from ? (Math.min(Math.max(t, seg.from), seg.to) - seg.from) / (seg.to - seg.from) : 0;
    return Math.min(100, Math.max(0, seg.left + ratio * seg.width));
  };
  const breaks = segments.filter((_, i) => i % 2 === 1).map((g) => ({ left: g.left, width: g.width, label: f.duration(g.to - g.from) }));
  return { x, breaks, active };
}

// ── Lignes de la cascade ─────────────────────────────────────────────────

export interface TraceRow {
  key: string;
  /** Id de l'appel, pour le détail (absent pour un groupe « ×6 »). */
  stepId: string | null;
  depth: number;
  kind: StepKind;
  name: string;
  label: string;
  start: number;
  /** null : en cours. */
  end: number | null;
  error: boolean;
  interrupted: boolean;
  count: number;
  agent: Pick<TraceAgent, 'name' | 'description' | 'state'> | null;
  children: TraceRow[];
}

const stepRow = (s: TraceStep, depth: number): TraceRow => ({
  key: s.id, stepId: s.id, depth, kind: s.kind, name: s.name, label: s.label, start: s.start, end: s.end,
  error: s.error, interrupted: !!s.interrupted, count: 1, agent: null, children: [],
});

/** Appels consécutifs du même outil, rapprochés dans le temps → un groupe « Read ×6 » dépliable. */
function grouped(steps: (TraceStep & { agent?: TraceAgent | null })[], depth: number): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const s of steps) {
    if (s.agent) {
      rows.push({ ...stepRow(s, depth), agent: { name: s.agent.name, description: s.agent.description, state: s.agent.state }, children: grouped(s.agent.steps, depth + 1) });
      continue;
    }
    let prev = rows.at(-1);
    const prevEnd = prev ? (prev.end ?? Infinity) : 0;
    if (prev && !prev.agent && prev.name === s.name && s.start - prevEnd < MERGE_GAP) {
      if (prev.count === 1) rows[rows.length - 1] = prev = { ...prev, key: `g:${prev.key}`, stepId: null, label: '', children: [{ ...prev, depth: depth + 1 }] };
      prev.children.push(stepRow(s, depth + 1));
      prev.count++;
      prev.end = prev.end === null || s.end === null ? null : Math.max(prev.end, s.end);
      prev.error ||= s.error;
      prev.interrupted ||= !!s.interrupted;
      continue;
    }
    rows.push(stepRow(s, depth));
  }
  return rows;
}

export function turnRows(turn: TraceTurn): TraceRow[] {
  return grouped(turn.steps, 0);
}

// ── Filtres ──────────────────────────────────────────────────────────────

export interface TraceFilter {
  kinds: ReadonlySet<StepKind>;
  errorsOnly: boolean;
  query: string;
}

export const ALL_KINDS: StepKind[] = ['read', 'edit', 'command', 'agent', 'other'];
export const isFiltering = (filter: TraceFilter) => filter.errorsOnly || !!filter.query.trim() || filter.kinds.size < ALL_KINDS.length;

/** Une étape (ou l'appel qui lance un sous-agent) correspond-elle au filtre ? `q` : recherche déjà en minuscules. */
function matchesStep(s: Pick<TraceStep, 'kind' | 'error' | 'name' | 'label'>, agent: Pick<TraceAgent, 'name' | 'description'> | null, filter: TraceFilter, q: string): boolean {
  if (!filter.kinds.has(s.kind)) return false;
  if (filter.errorsOnly && !s.error) return false;
  if (q && !`${s.name} ${s.label} ${agent?.name ?? ''} ${agent?.description ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}
const matchesSelf = (row: TraceRow, filter: TraceFilter, q: string) => matchesStep(row, row.agent, filter, q);

/** Garde les lignes qui correspondent, et leurs parents (groupe, sous-agent) pour le contexte. */
export function filterRows(rows: TraceRow[], filter: TraceFilter): TraceRow[] {
  if (!isFiltering(filter)) return rows;
  const q = filter.query.trim().toLowerCase();
  return rows.flatMap((row) => {
    const children = filterRows(row.children, filter);
    if (children.length) return [{ ...row, children }];
    // Un groupe ne compte que par ses membres ; une étape (ou un sous-agent) par elle-même.
    return row.count === 1 && matchesSelf(row, filter, q) ? [{ ...row, children: row.agent ? [] : row.children }] : [];
  });
}

/** Clés des lignes à déplier pour rendre visible une étape (groupe « ×6 », sous-agent) ; null si elle n'y est pas. */
export function stepPath(rows: TraceRow[], stepId: string): string[] | null {
  for (const row of rows) {
    if (row.stepId === stepId) return [];
    const sub = stepPath(row.children, stepId);
    if (sub) return [row.key, ...sub];
  }
  return null;
}

// ── Résumés ──────────────────────────────────────────────────────────────

/** Toutes les étapes d'un tour, sous-agents compris. */
export const allSteps = (turn: TraceTurn): TraceStep[] => turn.steps.flatMap((s) => [s, ...(s.agent?.steps ?? [])]);

/** Intervalles d'activité d'un tour, pour son échelle. */
export const turnIntervals = (turn: TraceTurn, now: number): [number, number][] =>
  allSteps(turn).map((s) => [s.start, s.end ?? now]);

// ── Gantt en couloirs (toute la session) ─────────────────────────────────

export const MAIN_LANE = 'main';

export interface GanttBar {
  key: string;
  stepId: string;
  turn: number;
  kind: StepKind;
  name: string;
  label: string;
  start: number;
  /** null : en cours. */
  end: number | null;
  error: boolean;
  interrupted: boolean;
  /** Position sur l'échelle de la session, en % (0–100). */
  left: number;
  right: number;
  /** Ne correspond pas aux filtres : atténuée. */
  dim: boolean;
}

export interface GanttLane { id: string; name: string; description: string; bars: GanttBar[] }

export interface Gantt {
  scale: Scale;
  lanes: GanttLane[];
  turns: { index: number; x: number; prompt: string; start: number }[];
  /** Position de « maintenant » si la session tourne. */
  now: number | null;
  /** Attente en cours, en bout du couloir principal. */
  wait: { left: number; right: number } | null;
}

/** Toute la session sur une seule échelle compressée : un couloir pour l'agent principal, un par sous-agent (ordre d'apparition). */
export function gantt(trace: SessionTrace, filter: TraceFilter): Gantt | null {
  const turns = trace.turns;
  const last = turns.at(-1);
  if (!last) return null;
  const end = last.live ? Math.max(last.end, trace.now) : last.end;
  // Débuts et fins de tours comptent comme activité : un repère T3 ne tombe jamais dans une coupure.
  const intervals = turns.flatMap((t): [number, number][] => [[t.start, t.start], [t.end, t.end], ...turnIntervals(t, trace.now)]);
  const scale = compressedScale(intervals, turns[0].start, end);
  const q = filter.query.trim().toLowerCase();
  const filtering = isFiltering(filter);
  const bar = (s: TraceStep, turn: number, agent: TraceAgent | null): GanttBar => ({
    key: s.id, stepId: s.id, turn, kind: s.kind, name: s.name, label: s.label, start: s.start, end: s.end,
    error: s.error, interrupted: !!s.interrupted, left: scale.x(s.start), right: scale.x(s.end ?? trace.now),
    dim: filtering && !matchesStep(s, agent, filter, q),
  });
  const main: GanttLane = { id: MAIN_LANE, name: 'Principal', description: 'Agent principal', bars: [] };
  const subs: (GanttLane & { at: number })[] = [];
  for (const t of turns) {
    for (const s of t.steps) {
      main.bars.push(bar(s, t.index, s.agent));
      if (s.agent) subs.push({ id: s.agent.id, name: s.agent.name, description: s.agent.description, at: s.start, bars: s.agent.steps.map((x) => bar(x, t.index, null)) });
    }
  }
  return {
    scale,
    lanes: [main, ...subs.sort((a, b) => a.at - b.at).map(({ at: _, ...lane }) => lane)],
    turns: turns.map((t) => ({ index: t.index, x: scale.x(t.start), prompt: t.prompt, start: t.start })),
    now: last.live ? 100 : null,
    wait: last.live && trace.waiting ? { left: scale.x(Math.min(last.end, trace.now)), right: 100 } : null,
  };
}

/** Couloir voisin qui a au moins une barre (↑ : dir = -1, ↓ : dir = 1) ; null en bord : la flèche ne fait rien. */
export function nextLane(barCounts: number[], from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < barCounts.length; i += dir) if (barCounts[i] > 0) return i;
  return null;
}

/** Largeur minimale d'une barre à l'écran, et en dessous de quelle largeur une barre se fond dans sa voisine. */
export const MIN_BAR_PX = 3;
const NARROW_PX = 6;

export interface GanttBlock {
  key: string;
  bars: GanttBar[];
  count: number;
  /** Type dominant. */
  kind: StepKind;
  left: number;
  width: number;
  start: number;
  end: number | null;
  error: boolean;
  interrupted: boolean;
  dim: boolean;
}

/**
 * Regroupe, au zoom courant (`pxPerPct` : pixels pour 1 % de l'échelle), les barres d'un couloir qui se chevaucheraient
 * à l'écran en un bloc « ×N ». Deux longues barres qui se touchent restent séparées : seules les minuscules se fondent.
 */
export function clusterBars(bars: GanttBar[], pxPerPct: number): GanttBlock[] {
  const minPct = MIN_BAR_PX / pxPerPct;
  const narrow = (w: number) => w * pxPerPct < NARROW_PX;
  const out: GanttBlock[] = [];
  for (const b of [...bars].sort((p, q) => p.left - q.left)) {
    const prev = out.at(-1);
    const width = b.right - b.left;
    if (prev && b.left < prev.left + Math.max(prev.width, minPct) + 1 / pxPerPct && (narrow(width) || narrow(prev.width))) {
      prev.bars.push(b);
      prev.count++;
      prev.width = Math.max(prev.width, b.right - prev.left);
      prev.end = prev.end === null || b.end === null ? null : Math.max(prev.end, b.end);
      prev.error ||= b.error;
      prev.interrupted &&= b.interrupted;
      prev.dim &&= b.dim;
      continue;
    }
    out.push({ key: b.key, bars: [b], count: 1, kind: b.kind, left: b.left, width, start: b.start, end: b.end, error: b.error, interrupted: b.interrupted, dim: b.dim });
  }
  for (const block of out) {
    if (block.count === 1) continue;
    const tally = new Map<StepKind, number>();
    for (const b of block.bars) tally.set(b.kind, (tally.get(b.kind) ?? 0) + 1);
    block.kind = [...tally].sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

/** Libellé lu par le lecteur d'écran et affiché au survol : « Commande npm test, 4,2 s, erreur ». */
export function blockLabel(block: GanttBlock, now: number): string {
  const span = f.elapsed((block.end ?? now) - block.start);
  const state = block.end === null ? ', en cours' : block.interrupted ? ', interrompu' : '';
  if (block.count > 1) {
    const errors = block.bars.filter((b) => b.error).length;
    return `${block.count} étapes regroupées, ${span}${errors ? `, ${errors} en erreur` : ''}${state}, tour ${block.bars[0].turn} (clic pour zoomer)`;
  }
  const b = block.bars[0];
  return `${KIND_LABELS[b.kind]} ${b.label || b.name}, ${span}${b.error ? ', erreur' : ''}${state}, tour ${b.turn}`;
}

// ── Axe : libellés sans chevauchement ────────────────────────────────────

export interface AxisLabel { key: string; text: string; /** px sur le canevas */ x: number; /** 0 = le plus important */ prio: number }
export type Placed<T> = T & { align: 'start' | 'center' | 'end' };

/** Garde les libellés qui tiennent sans se chevaucher, par priorité ; ceux du bord s'alignent vers l'intérieur. */
export function thinLabels<T extends AxisLabel>(labels: T[], total: number, charPx = 6.2, gapPx = 6): Placed<T>[] {
  const taken: [number, number][] = [];
  const kept: Placed<T>[] = [];
  for (const l of [...labels].sort((a, b) => a.prio - b.prio || a.x - b.x)) {
    const w = l.text.length * charPx + 4;
    const align = l.x - w / 2 < 0 ? 'start' : l.x + w / 2 > total ? 'end' : 'center';
    const lo = align === 'start' ? l.x : align === 'end' ? l.x - w : l.x - w / 2;
    if (taken.some(([a, b]) => lo < b + gapPx && lo + w > a - gapPx)) continue;
    taken.push([lo, lo + w]);
    kept.push({ ...l, align });
  }
  return kept.sort((a, b) => a.x - b.x);
}

// ── Zoom ─────────────────────────────────────────────────────────────────

export const MAX_ZOOM = 200;
export interface ZoomView { zoom: number; scrollLeft: number }
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z));
const clampScroll = (s: number, viewW: number, z: number) => Math.min(Math.max(0, s), viewW * (z - 1));

/** Zoom autour d'un point : la fraction `anchor` (0–1) du canevas reste sous le pointeur, à `at` px du bord de la fenêtre. */
export function zoomAt(zoom: number, factor: number, anchor: number, at: number, viewW: number): ZoomView {
  const z = clampZoom(zoom * factor);
  return { zoom: z, scrollLeft: clampScroll(anchor * viewW * z - at, viewW, z) };
}

/** Zoom sur une plage (fractions 0–1 du canevas), centrée dans la fenêtre. */
export function zoomTo(a: number, b: number, viewW: number): ZoomView {
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(1, Math.max(a, b));
  const z = clampZoom(1 / Math.max(hi - lo, 1e-9));
  return { zoom: z, scrollLeft: clampScroll(((lo + hi) / 2) * viewW * z - viewW / 2, viewW, z) };
}
