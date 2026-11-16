import { describe, expect, it } from 'vitest';
import { Prefs, bell, deliver, groupLog, parseLog, pendingSessions, usageAlerts } from './attention';
import { aSession, anUsage } from './vigie.service.mock';
import * as f from './format';

const NOW = new Date(2026, 10, 13, 15).getTime();

describe('pendingSessions', () => {
  it("attentes d'abord, puis fins de tour, la plus ancienne en tête ; rien d'autre", () => {
    const list = pendingSessions([
      aSession({ id: 'run', state: 'running' }),
      aSession({ id: 'turn', state: 'turn', lastTs: NOW - 600_000 }),
      aSession({ id: 'q', state: 'waiting', reason: 'question', lastTs: NOW - 60_000 }),
      aSession({ id: 'p', state: 'waiting', reason: 'permission', detail: 'npm test', terminalId: 't1', lastTs: NOW - 120_000 }),
      aSession({ id: 'done', state: 'done' }),
    ], NOW);
    expect(list.map((r) => [r.s.id, r.label, r.canAllow])).toEqual([['p', 'Autorisation', true], ['q', 'Question', false], ['turn', 'À toi', false]]);
    expect(list[0].doing).toBe('Veut lancer npm test');
    expect(list[0].age).toBe(120_000);
  });
});

describe('usageAlerts', () => {
  const usage = anUsage({ today: { tokens: 1, cost: 24, cacheRate: 0.8 }, window: { ...anUsage().window, pct: 0.85, end: NOW + 3_600_000 } });
  const none = { cost: null, window: null };

  it('seuils franchis : coût du jour et fenêtre de 5 h', () => {
    const list = usageAlerts(usage, NOW, { dailyCost: 20, windowPct: 0.8 }, none);
    expect(list.map((a) => a.key)).toEqual(['cost', 'window']);
    expect(list[0].title).toBe(`Coût du jour ${f.usd(24)} (estimé)`);
  });

  it('ignorée pour aujourd’hui / pour cette fenêtre ; sans seuil, rien', () => {
    expect(usageAlerts(usage, NOW, { dailyCost: 20, windowPct: 0.8 }, { cost: new Date(NOW).toDateString(), window: String(NOW + 3_600_000) })).toEqual([]);
    expect(usageAlerts(usage, NOW, { dailyCost: null, windowPct: null }, none)).toEqual([]);
    expect(usageAlerts(usage, NOW, null, none)).toEqual([]);
  });
});

describe('bell', () => {
  it('pastille = sessions qui attendent seulement ; le reste dans le libellé', () => {
    const b = bell([aSession({ id: 'a', state: 'waiting', reason: 'permission' }), aSession({ id: 'b', state: 'waiting' }), aSession({ id: 'c', state: 'turn' })], 1, null);
    expect(b).toEqual({ waiting: 2, others: true, label: 'Notifications : 2 sessions attendent ton autorisation, 1 fin de tour, 1 alerte de consommation' });
  });

  it('une question : « ta réponse » ; rien : libellé simple, pas de point', () => {
    expect(bell([aSession({ state: 'waiting', reason: 'question' })], 0, null).label).toBe('Notifications : 1 session attend ta réponse');
    expect(bell([aSession({ state: 'running' })], 0, null)).toEqual({ waiting: 0, others: false, label: 'Notifications' });
  });

  it('fin de tour seule : point neutre, pas de pastille ; la pause est dite', () => {
    const b = bell([aSession({ state: 'turn' })], 0, NOW);
    expect(b.waiting).toBe(0);
    expect(b.others).toBe(true);
    expect(b.label).toContain(`en pause jusqu'à ${f.clock(NOW)}`);
  });
});

describe('groupLog', () => {
  it('regroupe par session : dernière issue et heures, la plus récente d’abord', () => {
    const groups = groupLog([
      { sessionId: 'a', title: 'audit-ui', kind: 'turn', ts: 1 },
      { sessionId: 'b', title: 'refacto', kind: 'permission', ts: 5 },
      { sessionId: 'a', title: 'audit-ui', kind: 'turn', ts: 3 },
      { sessionId: 'a', title: 'audit-ui', kind: 'question', ts: 2 },
    ]);
    expect(groups).toEqual([
      { sessionId: 'b', title: 'refacto', kind: 'permission', times: [5] },
      { sessionId: 'a', title: 'audit-ui', kind: 'turn', times: [3, 2, 1] },
    ]);
  });

  it('journal mémorisé illisible ou mal formé : ignoré', () => {
    expect(parseLog('{oops')).toEqual([]);
    expect(parseLog(JSON.stringify([{ sessionId: 'a', title: 't', kind: 'turn', ts: 1 }, { sessionId: 'b', kind: 'nope', ts: 2 }, null]))).toEqual([{ sessionId: 'a', title: 't', kind: 'turn', ts: 1 }]);
  });
});

describe('deliver', () => {
  const p: Prefs = { systemWaiting: true, turn: 'system', usage: true, sound: true };
  const focused = { focused: true, shown: false, paused: false };
  const away = { focused: false, shown: false, paused: false };

  it('Vigie a le focus : toast, jamais de système ; session affichée : rien que le son', () => {
    expect(deliver('waiting', focused, p)).toEqual({ toast: true, system: false, sound: true });
    expect(deliver('waiting', { ...focused, shown: true }, p)).toEqual({ toast: false, system: false, sound: true });
  });

  it('pas le focus : notification système selon le réglage du type', () => {
    expect(deliver('waiting', away, p)).toEqual({ toast: false, system: true, sound: true });
    expect(deliver('waiting', away, { ...p, systemWaiting: false }).system).toBe(false);
    expect(deliver('turn', away, { ...p, turn: 'inapp' }).system).toBe(false);
    expect(deliver('turn', focused, { ...p, turn: 'inapp' }).toast).toBe(true);
  });

  it('type coupé : rien du tout ; pause : ni son ni système, le toast reste', () => {
    expect(deliver('turn', focused, { ...p, turn: 'off' })).toEqual({ toast: false, system: false, sound: false });
    expect(deliver('usage', away, { ...p, usage: false })).toEqual({ toast: false, system: false, sound: false });
    expect(deliver('waiting', { ...away, paused: true }, p)).toEqual({ toast: false, system: false, sound: false });
    expect(deliver('waiting', { ...focused, paused: true }, p)).toEqual({ toast: true, system: false, sound: false });
  });
});
