import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { SessionSummary } from './core/models';
import { aSession, aSnapshot, provideVigieServiceMock } from './core/vigie.service.mock';
import { CLIENT_OS, ClientOs } from './core/platform';
import { App } from './app';

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

  it('hors mac, pas de libellé ⌘N (Chrome réserve Ctrl+N)', () => {
    expect(render([], true, 'mac').el.querySelector('kbd')!.textContent).toBe('⌘N');
    TestBed.resetTestingModule();
    expect(render([], true, 'linux').el.querySelector('kbd')).toBeNull();
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
