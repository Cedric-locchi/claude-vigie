import { describe, expect, it } from 'vitest';
import { activityMax, agentLabel, describeSession, stateLabel } from './session-view';
import { aSession, anAgent } from './vigie.service.mock';

const NOW = 100_000;

describe('describeSession', () => {
  it('Autoriser seulement pour une autorisation, dans un terminal de Vigie', () => {
    const can = (extra: Parameters<typeof aSession>[0]) => describeSession(aSession(extra), NOW, 1, 12).canAllow;
    expect(can({ state: 'waiting', reason: 'permission', terminalId: 't1' })).toBe(true);
    expect(can({ state: 'waiting', reason: 'question', terminalId: 't1' })).toBe(false);
    expect(can({ state: 'waiting', reason: 'permission', terminalId: null })).toBe(false); // lancée hors de Vigie
    expect(can({ state: 'running', terminalId: 't1' })).toBe(false);
  });

  it('en cours sans activité depuis 5 min : peut-être bloquée ; une seule minute active suffit', () => {
    const quiet = [3, 0, 0, 0, 0, 0];
    expect(describeSession(aSession({ state: 'running', activity: quiet }), NOW, 3, 12).stale).toBe(true);
    expect(describeSession(aSession({ state: 'running', activity: [...quiet.slice(0, -1), 1] }), NOW, 3, 12).stale).toBe(false);
    expect(describeSession(aSession({ state: 'done', activity: quiet }), NOW, 3, 12).stale).toBe(false);
  });

  it('âge : depuis quand elle attend, sinon la durée totale', () => {
    const s = { firstTs: 10_000, lastTs: 60_000 };
    expect(describeSession(aSession({ ...s, state: 'waiting' }), NOW, 1, 12).age).toBe(40_000);
    expect(describeSession(aSession({ ...s, state: 'turn' }), NOW, 1, 12).age).toBe(40_000);
    expect(describeSession(aSession({ ...s, state: 'running' }), NOW, 1, 12).age).toBe(50_000);
  });

  it('ce qui se passe, et sparkline à l’échelle commune (2 px au moins pour une minute active)', () => {
    expect(describeSession(aSession({ state: 'waiting', reason: 'question', detail: '' }), NOW, 1, 12).doing).toBe('Question : en pause');
    expect(describeSession(aSession({ state: 'waiting', reason: 'permission', detail: 'Bash · npm test' }), NOW, 1, 12).doing).toBe('Veut lancer Bash · npm test');
    expect(describeSession(aSession({ state: 'running', tool: null }), NOW, 1, 12).doing).toBe('réfléchit…');
    const list = [aSession({ activity: [0, 1, 10] }), aSession({ activity: [20] })];
    expect(activityMax(list)).toBe(20);
    expect(describeSession(list[0], NOW, activityMax(list), 12).spark).toEqual([0, 2, 6]);
  });
});

describe('libellés', () => {
  it('une attente dit sa raison ; un agent en souci passe avant son état', () => {
    expect([stateLabel('waiting', 'question'), stateLabel('waiting', undefined, 'long'), stateLabel('done', undefined)]).toEqual(['Question', 'Attend ton autorisation', 'Terminée']);
    expect([agentLabel(anAgent({ issue: 'boucle' })), agentLabel(anAgent({ state: 'done' }))]).toEqual(['Souci', 'Terminé']);
  });
});
