import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { SessionSummary } from '../../../core/models';
import { aSession, aSnapshot, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { SessionsPageComponent } from './sessions-page.component';

const NOW = new Date('2026-11-08T15:00:00').getTime();

function render(sessions: SessionSummary[] | null = [
  aSession({ id: 'r', title: 'Historique des parties', lastTs: NOW - 1000 }),
  aSession({ id: 'w', state: 'waiting', reason: 'permission', detail: 'Bash · npm test', terminalId: 't1', title: 'Suggestions', lastTs: NOW - 120_000 }),
]) {
  const sendKeys = vi.fn();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideConfirmServiceMock(true), provideVigieServiceMock({ snapshot: signal(sessions && aSnapshot({ now: NOW, sessions })), sendKeys })],
  });
  const fixture = TestBed.createComponent(SessionsPageComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, sendKeys };
}

describe('SessionsPageComponent', () => {
  it('indicateurs en direct : en attente, coût du jour, fenêtre', () => {
    const kpis = render().el.querySelector('.kpis')!;
    expect(kpis.querySelector('.kpi.hot')!.textContent).toContain('1');
    expect(kpis.textContent).toContain('62 %');
    expect(kpis.textContent).toMatch(/48,50\s\$/);
  });

  it('une ligne par session, la plus urgente en haut, avec ce qu’elle fait', () => {
    const rows = [...render().el.querySelectorAll('.board .row:not(.head)')];
    expect(rows.map((r) => r.querySelector('.title')!.textContent)).toEqual(['Suggestions', 'Historique des parties']);
    expect(rows[0].classList).toContain('urgent');
    expect(rows[0].textContent).toContain('Veut lancer Bash · npm test');
    expect(rows[0].textContent).toContain('2 min'); // attend depuis
    expect(rows[1].querySelectorAll('.spark i')).toHaveLength(15);
    expect(rows[1].textContent).toContain('1/2'); // sous-agents actifs / total
  });

  it('autorise directement depuis la ligne', () => {
    const { el, sendKeys } = render();
    el.querySelector<HTMLButtonElement>('.row.urgent button[variant=wait]')!.click();
    expect(sendKeys).toHaveBeenCalledWith('t1', expect.any(String));
  });

  it('attend le daemon', () => {
    expect(render(null).el.textContent).toContain('Connexion au daemon');
  });

  it('propose de reprendre une session lancée hors Vigie', () => {
    const { el } = render([aSession({ id: 'x', terminalId: null, state: 'done', lastTs: NOW - 1000 })]);
    expect(el.querySelector('.row:not(.head) .actions')!.textContent).toContain('Reprendre');
  });
});
