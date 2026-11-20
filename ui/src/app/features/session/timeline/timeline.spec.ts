import { describe, expect, it } from 'vitest';
import { SessionTrace, TraceStep, TraceTurn } from '../../../core/models';
import {
  ALL_KINDS, GanttBar, MAX_ZOOM, StepKind, blockLabel, clusterBars, compressedScale, filterRows, gantt, nextLane, stepPath, thinLabels, turnRows, zoomAt, zoomTo,
} from './timeline';

const S = 1000, MIN = 60_000, H = 3_600_000;
const step = (id: string, name: string, start: number, end: number | null, extra: Partial<TraceStep> = {}): TraceStep =>
  ({ id, name, kind: name === 'Read' ? 'read' : name === 'Edit' ? 'edit' : name === 'Bash' ? 'command' : name === 'Task' ? 'agent' : 'other', label: `${name.toLowerCase()} ${id}`, start, end, error: false, interrupted: false, ...extra });
const turn = (steps: TraceTurn['steps'], extra: Partial<TraceTurn> = {}): TraceTurn => ({ index: 1, start: 0, end: 10 * MIN, prompt: 'go', live: false, steps, ...extra });
const all = { kinds: new Set(ALL_KINDS), errorsOnly: false, query: '' };

describe('compressedScale', () => {
  it('linéaire sans silence', () => {
    const s = compressedScale([[0, 10 * S]], 0, 10 * S);
    expect(s.x(5 * S)).toBeCloseTo(50);
    expect(s.breaks).toEqual([]);
  });

  it('compresse un silence de 3 h en une coupure étroite', () => {
    const s = compressedScale([[0, 1 * MIN], [3 * H, 3 * H + MIN]], 0, 3 * H + MIN);
    expect(s.breaks).toHaveLength(1);
    expect(s.breaks[0].label).toBe('2 h 59');
    expect(s.breaks[0].width).toBeLessThanOrEqual(6);
    // L'activité se partage la largeur : le début de la 2e plage est juste après la coupure, pas au fond à droite.
    expect(s.x(3 * H)).toBeCloseTo(s.breaks[0].left + s.breaks[0].width);
    expect(s.x(30 * S)).toBeCloseTo(47 / 2, 0);
    expect(s.active).toBe(2 * MIN);
  });
});

describe('turnRows', () => {
  it('regroupe les appels successifs du même outil, garde le reste à part', () => {
    const rows = turnRows(turn([step('a', 'Read', 0, S, { agent: null } as never), step('b', 'Read', 2 * S, 3 * S), step('c', 'Read', 4 * S, 5 * S, { error: true }), step('d', 'Edit', 6 * S, 7 * S)].map((x) => ({ ...x, agent: null }))));
    expect(rows.map((r) => [r.name, r.count, r.stepId])).toEqual([['Read', 3, null], ['Edit', 1, 'd']]);
    expect(rows[0].error).toBe(true);
    expect(rows[0].children.map((c) => c.stepId)).toEqual(['a', 'b', 'c']);
    expect(rows[0].children[0].depth).toBe(1);
  });

  it("imbrique les étapes d'un sous-agent sous l'appel qui l'a lancé", () => {
    const agent = { id: 'x', name: 'Explore', description: 'chercher', state: 'done' as const, steps: [step('g', 'Grep', 2 * S, 3 * S)] };
    const [row] = turnRows(turn([{ ...step('t', 'Task', S, 10 * S), agent }]));
    expect(row.agent?.name).toBe('Explore');
    expect(row.children.map((c) => [c.name, c.depth])).toEqual([['Grep', 1]]);
  });
});

describe('filterRows', () => {
  const rows = () => turnRows(turn([
    { ...step('a', 'Read', 0, S), agent: null },
    { ...step('b', 'Bash', 2 * S, 30 * S, { error: true, label: 'npm test' }), agent: null },
    { ...step('t', 'Task', 40 * S, 50 * S), agent: { id: 'x', name: 'Explore', description: '', state: 'done', steps: [step('e', 'Edit', 41 * S, 42 * S, { label: 'src/app.ts' })] } },
  ]));

  it('erreurs seules', () => {
    expect(filterRows(rows(), { ...all, errorsOnly: true }).map((r) => r.stepId)).toEqual(['b']);
  });

  it('recherche dans le libellé, en gardant le sous-agent parent pour le contexte', () => {
    const [agent] = filterRows(rows(), { ...all, query: 'app.ts' });
    expect(agent.stepId).toBe('t');
    expect(agent.children.map((c) => c.stepId)).toEqual(['e']);
  });

  it('par type', () => {
    expect(filterRows(rows(), { ...all, kinds: new Set(['command'] as const) }).map((r) => r.stepId)).toEqual(['b']);
  });
});

describe('gantt', () => {
  const trace = (): SessionTrace => ({
    now: 20 * MIN, state: 'waiting', waiting: { reason: 'permission', detail: 'Bash' },
    turns: [
      turn([{ ...step('r', 'Read', 0, S), agent: null }, { ...step('t', 'Task', 2 * S, 30 * S), agent: { id: 'x', name: 'Explore', description: 'chercher', state: 'done', steps: [step('g', 'Grep', 3 * S, 4 * S)] } }], { end: MIN }),
      turn([{ ...step('b', 'Bash', 15 * MIN, null, { label: 'npm test' }), agent: null }], { index: 2, start: 15 * MIN, end: 20 * MIN, live: true }),
    ],
  });

  it('un couloir principal puis un par sous-agent, repères de tours, coupure, attente et « maintenant »', () => {
    const g = gantt(trace(), all)!;
    expect(g.lanes.map((l) => [l.id, l.name, l.bars.map((b) => b.stepId)])).toEqual([['main', 'Principal', ['r', 't', 'b']], ['x', 'Explore', ['g']]]);
    expect(g.turns.map((t) => t.index)).toEqual([1, 2]);
    expect(g.scale.breaks.map((b) => b.label)).toEqual(['14 min']);
    // Le tour 2 commence juste après la coupure, pas au milieu.
    expect(g.turns[1].x).toBeCloseTo(g.scale.breaks[0].left + g.scale.breaks[0].width);
    expect(g.now).toBe(100);
    expect(g.wait?.right).toBe(100);
    expect(g.lanes[0].bars[2].right).toBe(100);
  });

  it('les filtres atténuent les barres sans les retirer', () => {
    const g = gantt(trace(), { ...all, query: 'npm' })!;
    expect(g.lanes[0].bars.map((b) => [b.stepId, b.dim])).toEqual([['r', true], ['t', true], ['b', false]]);
    expect(g.lanes[1].bars[0].dim).toBe(true);
  });
});

describe('clusterBars', () => {
  const bar = (id: string, left: number, right: number, kind: StepKind = 'read', extra: Partial<GanttBar> = {}): GanttBar =>
    ({ key: id, stepId: id, turn: 1, kind, name: id, label: '', start: left, end: right, error: false, interrupted: false, left, right, dim: false, ...extra });

  it('fond les barres minuscules qui se chevauchent à ce zoom, garde le type dominant et les erreurs', () => {
    // 10 px pour 1 % : barres de 1 px collées.
    const blocks = clusterBars([bar('a', 10, 10.1), bar('b', 10.2, 10.3, 'edit'), bar('c', 10.35, 10.5, 'read', { error: true }), bar('d', 50, 60)], 10);
    expect(blocks.map((b) => [b.key, b.count, b.kind, b.error])).toEqual([['a', 3, 'read', true], ['d', 1, 'read', false]]);
    expect(blocks[0].width).toBeCloseTo(0.5);
  });

  it('en zoomant, les mêmes barres se séparent', () => {
    expect(clusterBars([bar('a', 10, 10.1), bar('b', 10.2, 10.3)], 100).map((b) => b.count)).toEqual([1, 1]);
  });

  it('deux longues barres qui se touchent restent distinctes', () => {
    expect(clusterBars([bar('a', 0, 10), bar('b', 10, 20, 'edit')], 10)).toHaveLength(2);
  });

  it('libellé lisible', () => {
    const [b] = clusterBars([bar('a', 0, 10, 'command', { name: 'Bash', label: 'npm test', start: 0, end: 4200, error: true })], 10);
    expect(blockLabel(b, 0)).toBe('Commande npm test, 4,2 s, erreur, tour 1');
  });
});

describe('thinLabels', () => {
  it('garde les plus importants sans chevauchement et aligne ceux du bord vers l’intérieur', () => {
    const kept = thinLabels([
      { key: 'now', text: 'maintenant', x: 1000, prio: 0 },
      { key: 't1', text: 'T1', x: 0, prio: 1 },
      { key: 't2', text: 'T2', x: 10, prio: 1 },
      { key: 'b', text: '⋯ 3 min ⋯', x: 990, prio: 2 },
    ], 1000);
    expect(kept.map((l) => [l.key, l.align])).toEqual([['t1', 'start'], ['now', 'end']]);
  });
});

describe('zoom', () => {
  it('garde le point sous le pointeur', () => {
    // Fenêtre de 1000 px, pointeur à 250 px sur la moitié gauche du canevas (fraction 0,25).
    const v = zoomAt(1, 4, 0.25, 250, 1000);
    expect(v.zoom).toBe(4);
    expect(0.25 * 4000 - v.scrollLeft).toBe(250);
  });

  it('borne le zoom et le défilement', () => {
    expect(zoomAt(1, 0.5, 0.5, 500, 1000)).toEqual({ zoom: 1, scrollLeft: 0 });
    expect(zoomAt(MAX_ZOOM, 2, 1, 1000, 1000).zoom).toBe(MAX_ZOOM);
  });

  it('zoome sur une plage, centrée', () => {
    const v = zoomTo(0.6, 0.4, 1000);
    expect(v.zoom).toBeCloseTo(5);
    expect(v.scrollLeft).toBeCloseTo(2000);
  });
});

describe('stepPath', () => {
  it('donne les lignes à déplier pour atteindre une étape', () => {
    const rows = turnRows(turn([
      { ...step('a', 'Read', 0, S), agent: null }, { ...step('b', 'Read', 2 * S, 3 * S), agent: null },
      { ...step('t', 'Task', 4 * S, 9 * S), agent: { id: 'x', name: 'Explore', description: '', state: 'done', steps: [step('g', 'Grep', 5 * S, 6 * S)] } },
    ]));
    expect(stepPath(rows, 'b')).toEqual(['g:a']);
    expect(stepPath(rows, 'g')).toEqual(['t']);
    expect(stepPath(rows, 't')).toEqual([]);
    expect(stepPath(rows, 'zz')).toBeNull();
  });
});

describe('nextLane', () => {
  it('saute les couloirs sans barre et ne fait rien en bord', () => {
    const counts = [3, 0, 0, 2, 0];
    expect(nextLane(counts, 0, 1)).toBe(3);
    expect(nextLane(counts, 3, -1)).toBe(0);
    expect(nextLane(counts, 3, 1)).toBeNull();
    expect(nextLane(counts, 0, -1)).toBeNull();
  });
});
