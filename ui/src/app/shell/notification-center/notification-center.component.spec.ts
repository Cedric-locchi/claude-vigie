import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Snapshot } from '../../core/models';
import { NotificationCenterComponent } from './notification-center.component';
import { aSession, aSnapshot, provideVigieServiceMock } from '../../core/vigie.service.mock';

const perm = aSession({ id: 'p', title: 'refacto-store', state: 'waiting', reason: 'permission', detail: 'npm test', terminalId: 't1' });
const turn = aSession({ id: 't', title: 'audit-ui', state: 'turn' });

async function render(sendKeys = vi.fn(async () => ({ ok: true }))) {
  const snapshot = signal<Snapshot | null>(aSnapshot({ sessions: [perm, turn] }));
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideVigieServiceMock({ snapshot, sendKeys })] });
  const fixture = TestBed.createComponent(NotificationCenterComponent);
  fixture.detectChanges();
  const bell = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.bell')!;
  bell.click();
  fixture.detectChanges();
  await fixture.whenStable();
  // Le panneau s'affiche dans l'overlay CDK, hors du composant.
  const panel = () => document.querySelector('hlm-sheet-content')!;
  return { fixture, bell, panel, snapshot, sendKeys };
}

describe('NotificationCenterComponent', () => {
  beforeEach(() => localStorage.clear()); // pause ou journal laissés par un autre fichier de test
  afterEach(() => document.querySelectorAll('hlm-sheet-content').forEach((e) => e.remove()));

  it('cloche : pastille = sessions qui attendent seulement, libellé explicite', async () => {
    const { bell } = await render();
    expect(bell.querySelector('.count')!.textContent!.trim()).toBe('1');
    expect(bell.getAttribute('aria-label')).toBe('Notifications : 1 session attend ton autorisation, 1 fin de tour');
  });

  it('Autoriser depuis le panneau tape la touche dans le terminal ; un échec s’affiche sur la ligne', async () => {
    const sendKeys = vi.fn(async () => { throw { status: 0 }; });
    const { fixture, panel } = await render(sendKeys);
    expect(panel().textContent).toContain('Veut lancer npm test');
    panel().querySelector<HTMLButtonElement>('[aria-label="Autoriser : refacto-store"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sendKeys).toHaveBeenCalledWith('t1', '\r');
    expect(panel().querySelector('[role=alert]')!.textContent).toContain('le daemon ne répond pas');
  });

  it("une entrée disparaît d'elle-même quand la session change d'état", async () => {
    const { fixture, panel, snapshot } = await render();
    expect(panel().querySelectorAll('.todo .item')).toHaveLength(2);
    snapshot.set(aSnapshot({ sessions: [{ ...perm, state: 'running' }, turn] }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect([...panel().querySelectorAll('.todo .item .title')].map((e) => e.textContent)).toEqual(['audit-ui']);
  });
});
