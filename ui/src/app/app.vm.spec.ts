import { TestBed } from '@angular/core/testing';
import { DOCUMENT, EnvironmentInjector, createEnvironmentInjector, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { aSession, aSnapshot, provideVigieServiceMock } from './core/vigie.service.mock';
import { AppVm } from './app.vm';
import { CLIENT_OS } from './core/platform';

function createVm() {
  const sessions = [aSession({ id: 'a', state: 'waiting' }), aSession({ id: 'b', state: 'turn' }), aSession({ id: 'c', state: 'done' })];
  TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock({ snapshot: signal(aSnapshot({ sessions })) })] });
  return TestBed.inject(AppVm);
}

describe('AppVm', () => {
  it('liste les sessions actives et compte celles qui attendent une réponse', () => {
    const vm = createVm();
    expect(vm.active().map((s) => s.id)).toEqual(['a', 'b']);
    expect(vm.waitingCount()).toBe(1); // la fin de tour (b) n'est pas une demande
  });

  it('groupe par état sans groupe vide, et ignore les terminées des jours précédents', () => {
    const vm = createVm();
    expect(vm.groups().map((g) => [g.key, g.rows.map((r) => r.s.id)])).toEqual([['waiting', ['a']], ['turn', ['b']], ['done', ['c']]]);
  });

  it('⌘N ouvre une nouvelle session sans ouvrir de fenêtre', () => {
    const vm = createVm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const event = new KeyboardEvent('keydown');
    const prevent = vi.spyOn(event, 'preventDefault');
    vm.newSession(event);
    expect(prevent).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/new']);
  });

  it('Discussion : lance Claude sans projet et ouvre la session ; affiche l’échec', async () => {
    const startChat = vi.fn(async () => ({ sessionId: 'chat1' }) as never);
    TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock({ startChat })] });
    const vm = TestBed.inject(AppVm);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await vm.newChat();
    expect(navigate).toHaveBeenCalledWith(['/sessions', 'chat1']);
    startChat.mockRejectedValueOnce(new Error('404'));
    await vm.newChat();
    expect(vm.chatError()).toMatch(/Discussion impossible/);
  });

  it('Autoriser depuis la sidebar : un échec s’affiche sur la ligne de la session', async () => {
    const sendKeys = vi.fn(async () => { throw { status: 0 }; });
    const waiting = aSession({ id: 'a', state: 'waiting', reason: 'permission', terminalId: 't1' });
    TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock({ sendKeys, snapshot: signal(aSnapshot({ sessions: [waiting] })) })] });
    const vm = TestBed.inject(AppVm);
    await vm.allow(waiting);
    expect(sendKeys).toHaveBeenCalledWith('t1', '\r');
    expect(vm.replyError()).toEqual({ id: 'a', message: "Impossible d'envoyer la réponse au terminal : le daemon ne répond pas. Réessaie." });
  });

  it('daemon injoignable : bandeau après 3 s de coupure, avec l’âge des données ; rien avant le premier snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const connected = signal(true);
      const snapshot = signal<ReturnType<typeof aSnapshot> | null>(aSnapshot({ now: 1_000_000 }));
      TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock({ connected, snapshot })] });
      const vm = TestBed.inject(AppVm);
      expect(vm.offline()).toBeNull();
      connected.set(false);
      vm.offline(); // la coupure est datée à sa détection
      vi.advanceTimersByTime(2000);
      expect(vm.offline()).toBeNull(); // reconnexion rapide : pas de clignotement
      vi.advanceTimersByTime(2000);
      expect(vm.offline()).toEqual({ age: '4 s' });
      vi.advanceTimersByTime(120_000);
      expect(vm.offline()).toEqual({ age: '2 min' });
      connected.set(true);
      expect(vm.offline()).toBeNull();
      connected.set(false);
      snapshot.set(null);
      vi.advanceTimersByTime(10_000);
      expect(vm.offline()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('commande de redémarrage du daemon selon l’OS du client', () => {
    TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock(), { provide: CLIENT_OS, useValue: 'linux' }] });
    expect(TestBed.inject(AppVm).restartCommand).toBe('systemctl --user restart vigie');
  });

  it('statut de Claude : libellé et incidents ; rien tant que le daemon ne l’a pas relevé', () => {
    const snapshot = signal(aSnapshot({ claudeStatus: { indicator: 'major', incidents: [{ name: 'Erreurs API', url: 'https://status.claude.com/incidents/x' }] } }));
    TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock({ snapshot })] });
    const vm = TestBed.inject(AppVm);
    expect(vm.claudeStatus()).toEqual({ label: 'Claude : panne partielle', tone: 'err', incidents: [{ name: 'Erreurs API', url: 'https://status.claude.com/incidents/x' }] });
    snapshot.set(aSnapshot({ claudeStatus: undefined }));
    expect(vm.claudeStatus()).toBeNull();
  });

  it('Recharger (palette impossible à charger) : recharge toute l’app', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideVigieServiceMock()] });
    const reload = vi.fn();
    // DOCUMENT factice pour le seul VM : les services racine (AttentionService…) gardent le vrai.
    const injector = createEnvironmentInjector([AppVm, { provide: DOCUMENT, useValue: { location: { reload } } }], TestBed.inject(EnvironmentInjector));
    injector.get(AppVm).reloadPage();
    expect(reload).toHaveBeenCalledOnce();
    injector.destroy();
  });

  it('⌘F (mac) / Ctrl+F (ailleurs) ouvre la palette de recherche ; ignoré si déjà pris, avec Maj, dans le terminal hors mac ou dans un dialogue', () => {
    const vmFor = (os: 'mac' | 'linux') => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [AppVm, provideRouter([]), provideVigieServiceMock(), { provide: CLIENT_OS, useValue: os }] });
      return TestBed.inject(AppVm);
    };
    const term = document.body.appendChild(document.createElement('div'));
    term.className = 'xterm';
    const inTerm = term.appendChild(document.createElement('textarea'));
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.setAttribute('open', '');
    const inDialog = dialog.appendChild(document.createElement('input'));
    /** Touche envoyée sur `target` ; `taken` : un écouteur plus proche l'a déjà prise (preventDefault). */
    const fire = (vm: AppVm, target: EventTarget, init: KeyboardEventInit, taken = false) => {
      vm.searchOpen.set(false);
      const ev = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...init });
      target.addEventListener('keydown', (e) => { if (taken) e.preventDefault(); vm.searchShortcut(e as KeyboardEvent); }, { once: true });
      target.dispatchEvent(ev);
      return [vm.searchOpen(), ev.defaultPrevented];
    };

    const mac = vmFor('mac');
    expect(mac.searchKey).toBe('⌘F');
    expect(fire(mac, document.body, { metaKey: true })).toEqual([true, true]);
    expect(fire(mac, inTerm, { metaKey: true })).toEqual([true, true]); // ⌘F n'est pas au terminal
    expect(fire(mac, document.body, { ctrlKey: true })).toEqual([false, false]);
    expect(fire(mac, document.body, { metaKey: true, shiftKey: true, key: 'F' })).toEqual([false, false]);
    expect(fire(mac, document.body, { metaKey: true }, true)).toEqual([false, true]); // vue Fichiers : recherche dans le fichier
    expect(fire(mac, inDialog, { metaKey: true })).toEqual([false, false]);

    const linux = vmFor('linux');
    expect(linux.searchKey).toBe('Ctrl+F');
    expect(fire(linux, document.body, { ctrlKey: true })).toEqual([true, true]);
    expect(fire(linux, inTerm, { ctrlKey: true })).toEqual([false, false]); // Ctrl+F appartient au terminal
    expect(fire(linux, document.body, { metaKey: true })).toEqual([false, false]);
    term.remove();
    dialog.remove();
  });
});
