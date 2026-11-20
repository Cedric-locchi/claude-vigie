import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Alerts, Snapshot, Usage } from './models';
import { aSession, aSettings, aSnapshot, anUsage, fakeResource, provideVigieServiceMock } from './vigie.service.mock';
import { AttentionService } from './attention.service';
import * as f from './format';

class FakeNotification {
  static permission = 'granted';
  static instances: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => 'granted');
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) { FakeNotification.instances.push(this); }
}
const tones: number[] = [];
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => undefined);
  createOscillator() { return { type: '', frequency: { set value(v: number) { tones.push(v); } }, connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn() }; }
  createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (n: unknown) => n }; }
}

function setup() {
  const snapshot = signal<Snapshot | null>(aSnapshot({ sessions: [aSession({ id: 'a', state: 'running' }), aSession({ id: 'b', state: 'waiting', reason: 'permission' })] }));
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }]), provideVigieServiceMock({ snapshot })] });
  const service = TestBed.inject(AttentionService);
  TestBed.tick();
  const update = (sessions: Snapshot['sessions']) => { snapshot.set(aSnapshot({ sessions })); TestBed.tick(); };
  return { service, update };
}

describe('AttentionService', () => {
  beforeEach(() => {
    FakeNotification.instances = [];
    tones.length = 0;
    localStorage.clear();
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ne prévient pas pour ce qui attendait déjà au démarrage", () => {
    setup();
    expect(FakeNotification.instances).toHaveLength(0);
    expect(tones).toEqual([]);
  });

  it('demande d’autorisation : notification + deux notes ; fin de tour : une note', () => {
    const { update } = setup();
    update([aSession({ id: 'a', state: 'waiting', reason: 'permission', title: 'Refonte', detail: 'Bash · npm test' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(FakeNotification.instances.map((n) => [n.title, n.options.body])).toEqual([['Claude demande une autorisation', 'Refonte — Bash · npm test']]);
    expect(FakeNotification.instances[0].options.silent).toBe(true);
    expect(tones).toEqual([660, 990]);
    tones.length = 0;
    update([aSession({ id: 'a', state: 'turn', title: 'Refonte' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(FakeNotification.instances.at(-1)!.title).toBe('Claude a fini, à toi');
    expect(tones).toEqual([740]);
  });

  it('un clic sur la notification ouvre la session', () => {
    const { update } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    update([aSession({ id: 'a', state: 'waiting', reason: 'question' }), aSession({ id: 'b', state: 'waiting' })]);
    FakeNotification.instances[0].onclick!();
    expect(navigate).toHaveBeenCalledWith(['/sessions', 'a']);
  });

  it('pas de notification pour la session affichée dans la fenêtre active, mais le son reste', async () => {
    const { update } = setup();
    await TestBed.inject(Router).navigateByUrl('/sessions/a');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    update([aSession({ id: 'a', state: 'waiting' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(FakeNotification.instances).toHaveLength(0);
    expect(tones).toEqual([660, 990]);
  });

  it('réglages coupés et mémorisés', () => {
    const { service, update } = setup();
    service.setSystemWaiting(false);
    service.setTurn('off');
    service.setSound(false);
    update([aSession({ id: 'a', state: 'waiting' }), aSession({ id: 'b', state: 'waiting' }), aSession({ id: 'c', state: 'turn' })]);
    expect(FakeNotification.instances).toHaveLength(0);
    expect(tones).toEqual([]);
    expect(localStorage.getItem('vigie-notify')).toBe('off');
    expect(localStorage.getItem('vigie-notify-turn')).toBe('off');
  });

  it('affiche le nombre de demandes en attente dans le titre', () => {
    setup();
    expect(document.title).toBe('(1) Vigie');
  });

  it("activer les notifications envoie un essai, et signale quand le système les bloque", async () => {
    const { service } = setup();
    await service.setSystemWaiting(true);
    expect(FakeNotification.instances.at(-1)!.title).toBe('Notifications Vigie activées');
    FakeNotification.permission = 'denied';
    await service.setSystemWaiting(true);
    expect(service.permission()).toBe('denied');
    FakeNotification.permission = 'granted';
  });

  it("demande l'autorisation au premier clic quand elle n'a pas encore été donnée", async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission.mockImplementation(async () => { FakeNotification.permission = 'granted'; return 'granted'; });
    const { service } = setup();
    document.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve(); await Promise.resolve();
    expect(FakeNotification.requestPermission).toHaveBeenCalled();
    expect(service.permission()).toBe('granted');
  });

  it("Vigie a le focus : toast plutôt que notification système ; il disparaît quand la session change d'état", () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { service, update } = setup();
    update([aSession({ id: 'a', state: 'waiting', reason: 'permission', terminalId: 't1' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(FakeNotification.instances).toHaveLength(0);
    expect(service.toasts().map((t) => [t.sessionId, t.kind, t.row?.canAllow])).toEqual([['a', 'waiting', true]]);
    update([aSession({ id: 'a', state: 'running' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(service.toasts()).toEqual([]);
  });

  it('une fin de tour en toast se ferme seule ; trois toasts au plus', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { service, update } = setup();
    const turns = ['c', 'd', 'e', 'f'].map((id) => aSession({ id, state: 'turn' }));
    update([aSession({ id: 'b', state: 'waiting' }), ...turns]);
    expect(service.toasts().map((t) => t.sessionId)).toEqual(['d', 'e', 'f']);
    vi.advanceTimersByTime(6000);
    expect(service.toasts()).toEqual([]);
    vi.useRealTimers();
  });

  it('pause : ni son ni notification système ; reprise', () => {
    const { service, update } = setup();
    service.pause();
    expect(service.pausedUntil()).not.toBeNull();
    update([aSession({ id: 'a', state: 'waiting' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(FakeNotification.instances).toHaveLength(0);
    expect(tones).toEqual([]);
    service.resume();
    update([aSession({ id: 'a', state: 'turn' }), aSession({ id: 'b', state: 'waiting' })]);
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('journal « Plus tôt » : noté quand l’attente se termine, regroupé, mémorisé sans le détail', () => {
    const { service, update } = setup();
    update([aSession({ id: 'a', state: 'running' }), aSession({ id: 'b', state: 'waiting', title: 'Refonte', detail: 'rm -rf secret' })]);
    expect(service.history()).toEqual([]); // encore à traiter
    update([aSession({ id: 'a', state: 'running' }), aSession({ id: 'b', state: 'running', title: 'Refonte', lastTs: 90_000 })]);
    expect(service.history().map((g) => [g.sessionId, g.title, g.kind, g.times])).toEqual([['b', 'Refonte', 'permission', [60_000]]]);
    expect(localStorage.getItem('vigie-attention-log')).not.toContain('rm -rf');
    service.clearHistory();
    expect(service.history()).toEqual([]);
  });

  it('Autoriser : la touche part dans le terminal ; un échec est gardé pour la ligne', async () => {
    const sendKeys = vi.fn(async () => { throw { status: 0 }; });
    const snapshot = signal<Snapshot | null>(aSnapshot({ sessions: [aSession({ id: 'a', state: 'waiting', reason: 'permission', terminalId: 't1' })] }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideVigieServiceMock({ snapshot, sendKeys })] });
    const service = TestBed.inject(AttentionService);
    await service.reply('a', 'allow');
    expect(sendKeys).toHaveBeenCalledWith('t1', '\r');
    expect(service.replyError()).toEqual({ id: 'a', message: "Impossible d'envoyer la réponse au terminal : le daemon ne répond pas. Réessaie." });
  });

  it("réponse rapide : rien si la session n'attend plus ; l'échec s'oublie quand la session change d'état", async () => {
    const sendKeys = vi.fn(async () => { throw { status: 404, error: { error: 'terminal inconnu' } }; });
    const snapshot = signal<Snapshot | null>(aSnapshot({ sessions: [aSession({ id: 'a', state: 'waiting', reason: 'permission', terminalId: 't1' })] }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideVigieServiceMock({ snapshot, sendKeys })] });
    const service = TestBed.inject(AttentionService);
    TestBed.tick();
    expect(await service.send('a', 't1', '/compact')).toBe(false);
    expect(service.replyError()).toEqual({ id: 'a', message: "Impossible d'envoyer la réponse au terminal : terminal inconnu. Réessaie." });
    snapshot.set(aSnapshot({ sessions: [aSession({ id: 'a', state: 'waiting', reason: 'permission', terminalId: 't1', lastTs: 70_000 })] }));
    TestBed.tick();
    expect(service.replyError()?.id).toBe('a'); // même état : l'échec reste affiché
    snapshot.set(aSnapshot({ sessions: [aSession({ id: 'a', state: 'running', terminalId: 't1' })] }));
    TestBed.tick();
    expect(service.replyError()).toBeNull(); // traitée ailleurs
    sendKeys.mockClear();
    await service.reply('a', 'refuse');
    expect(sendKeys).not.toHaveBeenCalled();
  });

  describe('alertes de consommation', () => {
    const NOW = new Date(2026, 10, 13, 15).getTime();
    function setupAlerts(alerts: Alerts) {
      const snapshot = signal<Snapshot | null>(aSnapshot({ now: NOW, usage: anUsage({ today: { tokens: 1, cost: 5, cacheRate: 0.8 } }) }));
      TestBed.configureTestingModule({
        providers: [provideRouter([{ path: '**', children: [] }]), provideVigieServiceMock({
          snapshot, settingsResource: () => fakeResource(aSettings({ alerts })),
        })],
      });
      const service = TestBed.inject(AttentionService);
      TestBed.tick();
      const usage = (u: Partial<Usage>, now = NOW) => { snapshot.set(aSnapshot({ now, usage: anUsage(u) })); TestBed.tick(); };
      return { service, usage };
    }
    const today = (cost: number) => ({ today: { tokens: 1, cost, cacheRate: 0.8 } });
    const win = (pct: number, end = NOW + 3_600_000) => ({ window: { ...anUsage().window, pct, end }, today: { tokens: 1, cost: 0, cacheRate: 0.8 } });

    it('coût du jour : une seule alerte par jour, même si le coût continue de monter', () => {
      const { service, usage } = setupAlerts({ dailyCost: 20, windowPct: null });
      expect(FakeNotification.instances).toHaveLength(0); // 5 $ : sous le seuil
      usage(today(21));
      usage(today(35));
      expect(FakeNotification.instances.map((n) => n.title)).toEqual([`Coût du jour ${f.usd(21)} (estimé)`]);
      expect(service.usageAlerts().map((a) => a.key)).toEqual(['cost']);
      service.dismiss(service.usageAlerts()[0]);
      expect(service.usageAlerts()).toEqual([]);
      usage(today(40), NOW + 24 * 3_600_000); // lendemain
      expect(FakeNotification.instances).toHaveLength(2);
    });

    it('fenêtre de 5 h : une seule alerte par fenêtre ; un clic ouvre la consommation', () => {
      const { usage } = setupAlerts({ dailyCost: null, windowPct: 0.8 });
      usage(win(0.7));
      expect(FakeNotification.instances).toHaveLength(0);
      usage(win(0.85));
      usage(win(0.95));
      expect(FakeNotification.instances.map((n) => n.title)).toEqual(['Fenêtre de 5 h à 85 % (estimé)']);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      FakeNotification.instances[0].onclick!();
      expect(navigate).toHaveBeenCalledWith(['/usage']);
      usage(win(0.9, NOW + 6 * 3_600_000)); // fenêtre suivante
      expect(FakeNotification.instances).toHaveLength(2);
    });

    it('ne répète pas l’alerte après un rechargement de l’interface', () => {
      setupAlerts({ dailyCost: 4, windowPct: null });
      expect(FakeNotification.instances).toHaveLength(1);
      TestBed.resetTestingModule();
      setupAlerts({ dailyCost: 4, windowPct: null });
      expect(FakeNotification.instances).toHaveLength(1);
    });

    it('seuils vides : aucune alerte', () => {
      const { usage } = setupAlerts({ dailyCost: null, windowPct: null });
      usage({ ...today(1000), window: { ...anUsage().window, pct: 1 } });
      expect(FakeNotification.instances).toHaveLength(0);
    });
  });
});
