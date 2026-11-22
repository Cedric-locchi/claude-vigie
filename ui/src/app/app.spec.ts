import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { SessionSummary } from './core/models';
import { aSession, aSnapshot, provideVigieServiceMock } from './core/vigie.service.mock';
import { CLIENT_OS, ClientOs } from './core/platform';
import { App } from './app';
import { AppVm } from './app.vm';

const NOW = new Date('2026-11-08T15:00:00').getTime();

function render(sessions: SessionSummary[] = [], connected = true, os: ClientOs = 'mac') {
  const sendKeys = vi.fn();
  TestBed.configureTestingModule({
    providers: [{ provide: CLIENT_OS, useValue: os }, provideRouter([{ path: '**', children: [] }]), provideVigieServiceMock({ snapshot: signal(aSnapshot({ now: NOW, sessions })), connected: signal(connected), sendKeys })],
  });
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, sendKeys };
}

const SESSIONS = [
  aSession({ id: 'run', title: 'Portage macOS', state: 'running', tool: 'Edit · api.ts', lastTs: NOW - 1000 }),
  aSession({ id: 'perm', title: 'Refonte nav', state: 'waiting', reason: 'permission', detail: 'Bash · npm test', terminalId: 't1', lastTs: NOW - 60_000 }),
  aSession({ id: 'old', title: 'Fix login', state: 'done', lastTs: NOW - 3_600_000 }),
];

describe('App (sidebar)', () => {
  it('groupe les sessions du jour par état, les plus urgentes en tête', () => {
    const { el } = render(SESSIONS);
    const labels = [...el.querySelectorAll('[hlmSidebarGroupLabel]')].map((l) => l.textContent!.trim());
    expect(labels).toEqual(['En attente · 1', 'En cours · 1', "Terminées aujourd'hui · 1"]);
    const sidebar = el.querySelector('hlm-sidebar')!;
    expect(sidebar.textContent).toContain('Veut lancer Bash · npm test');
    expect(sidebar.textContent).toContain('Edit · api.ts');
    // Terminées repliées par défaut.
    expect(sidebar.textContent).not.toContain('Fix login');
  });

  it('cloche des notifications dans la barre latérale et dans la barre mobile', () => {
    const { el } = render(SESSIONS);
    expect(el.querySelector('hlm-sidebar app-notification-center')).not.toBeNull();
    expect(el.querySelector('.mobile-bar app-notification-center')).not.toBeNull();
  });

  it('version de l\'app sous Réglages', () => {
    const { el } = render(SESSIONS);
    expect(el.querySelector('hlm-sidebar .app-version')?.textContent?.trim()).toMatch(/^Vigie v\d+\.\d+\.\d+/);
  });

  it('déplie les terminées à la demande', () => {
    const { fixture, el } = render(SESSIONS);
    el.querySelector<HTMLButtonElement>('button[hlmSidebarGroupLabel]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('hlm-sidebar')!.textContent).toContain('Fix login');
  });

  it('autorise directement depuis la sidebar', () => {
    const { el, sendKeys } = render(SESSIONS);
    el.querySelector<HTMLButtonElement>('button.allow')!.click();
    expect(sendKeys).toHaveBeenCalledWith('t1', expect.any(String));
  });

  it('filtre les sessions', () => {
    const { fixture, el } = render(SESSIONS);
    const input = el.querySelector<HTMLInputElement>('input[hlmSidebarInput]')!;
    input.value = 'portage';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const titles = [...el.querySelectorAll('.session .title')].map((t) => t.textContent);
    expect(titles).toEqual(['Portage macOS']);
  });

  it('⌘N déclenche une nouvelle session', async () => {
    const { fixture } = render();
    const navigate = vi.spyOn((fixture.componentInstance as unknown as { vm: { newSession: () => void } }).vm, 'newSession').mockImplementation(() => undefined);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));
    expect(navigate).toHaveBeenCalled();
  });

  it('hors mac, pas de libellé ⌘N (Chrome réserve Ctrl+N) ; la recherche affiche le raccourci de la plateforme', () => {
    const keys = (el: HTMLElement) => [...el.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys(render([], true, 'mac').el)).toEqual(['⌘N', '⌘F']);
    TestBed.resetTestingModule();
    expect(keys(render([], true, 'linux').el)).toEqual(['Ctrl+F']);
  });

  it('⌘F ou « Rechercher » dans la barre latérale : palette de recherche dans les sessions, focus dans le champ ; Échap la retire', async () => {
    const { fixture, el } = render(SESSIONS);
    document.body.append(el); // focus : seulement dans le document
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    const ev = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev); // écouté sur window
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    const dialog = el.querySelector('app-search-palette dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Rechercher dans les sessions');
    const input = dialog.querySelector<HTMLInputElement>('[role=combobox]')!;
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(el.querySelector('app-search-palette')).toBeNull();

    [...el.querySelectorAll<HTMLButtonElement>('hlm-sidebar button')].find((b) => b.textContent!.includes('Rechercher'))!.click();
    await settle();
    expect(el.querySelector('app-search-palette dialog[open]')).not.toBeNull();
    el.remove();
  });

  it('palette impossible à charger : message, Recharger, Fermer ou Échap la retirent ; une réouverture rend à nouveau le message', async () => {
    TestBed.configureTestingModule({ deferBlockBehavior: DeferBlockBehavior.Manual });
    const { fixture, el } = render();
    const vm = fixture.debugElement.injector.get(AppVm);
    const reload = vi.spyOn(vm, 'reloadPage').mockImplementation(() => undefined);
    /** Ouvre la recherche et fait échouer le chargement de la palette. */
    const failOpen = async () => {
      vm.openSearch();
      fixture.detectChanges();
      const [block] = await fixture.getDeferBlocks();
      await block.render(DeferBlockState.Error);
      return el.querySelector('dialog.search-error')!;
    };

    const box = await failOpen();
    expect(box.querySelector('[role=alert]')!.textContent).toBe("La recherche n'a pas pu se charger : l'interface a peut-être été mise à jour.");
    const [close, reloadBtn] = [...box.querySelectorAll('button')];
    expect([close.textContent, reloadBtn.textContent]).toEqual(['Fermer', 'Recharger']);
    reloadBtn.click();
    expect(reload).toHaveBeenCalledOnce();
    close.click();
    fixture.detectChanges();
    expect(vm.searchOpen()).toBe(false);
    expect(el.querySelector('dialog.search-error')).toBeNull();

    expect(await failOpen()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(vm.searchOpen()).toBe(false);
    expect(el.querySelector('dialog.search-error')).toBeNull();
  });

  it('met en évidence la session ouverte, même hors des groupes du jour', async () => {
    const yesterday = aSession({ id: 'hier', title: 'Vieille session', state: 'done', lastTs: NOW - 2 * 86_400_000 });
    const { fixture, el } = render([...SESSIONS, yesterday]);
    await TestBed.inject(Router).navigateByUrl('/sessions/hier');
    fixture.detectChanges();
    const labels = [...el.querySelectorAll('[hlmSidebarGroupLabel]')].map((l) => l.textContent!.trim());
    expect(labels[0]).toBe('Session ouverte · 1');
    const active = el.querySelector('.session[data-active=true]')!;
    expect(active.textContent).toContain('Vieille session');
    expect(active.getAttribute('aria-current')).toBe('page');
  });
});
