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
  it('Dashboard : indicateurs (fenêtre, coût du jour), puis une seule liste où l’attente reste à sa place', () => {
    const el = render().el;
    expect(el.querySelector('h1')!.textContent).toBe('Dashboard');
    const list = el.querySelector('[aria-labelledby="list-title"]')!;
    expect(list.textContent).toContain('Suggestions');
    expect(el.querySelector('app-dashboard-kpis')!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const kpis = el.querySelector('.kpis')!;
    expect(kpis.textContent).toContain('62 %');
    expect(kpis.textContent).toMatch(/48,50\s\$/);
  });

  it('pas de section d’attente en tête : une session qui attend est une ligne de la liste, avec ses actions', () => {
    const el = render().el;
    expect(el.querySelectorAll('[role="table"]')).toHaveLength(1);
    expect(el.querySelector('[aria-labelledby="list-title"] .row.urgent button[variant=wait]')).not.toBeNull();
  });

  it('une ligne par session à sa place (date de création), l’attente marquée sur sa ligne, avec ce qu’elle fait', () => {
    const rows = [...render().el.querySelectorAll('.board .row:not(.head)')];
    expect(rows.map((r) => r.querySelector('.title')!.textContent)).toEqual(['Historique des parties', 'Suggestions']);
    expect(rows[1].classList).toContain('urgent');
    expect(rows[1].textContent).toContain('Veut lancer Bash · npm test');
    expect(rows[1].textContent).toContain('2 min'); // attend depuis
    expect(rows[0].querySelectorAll('.spark i')).toHaveLength(15);
    expect(rows[0].textContent).toContain('1/2'); // sous-agents actifs / total
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
