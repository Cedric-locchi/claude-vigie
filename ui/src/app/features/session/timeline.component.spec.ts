import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { SessionTrace } from '../../core/models';
import { fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { VigieService } from '../../core/vigie.service';
import { TimelineComponent } from './timeline.component';

const MIN = 60_000;
const TRACE: SessionTrace = {
  now: 100 * MIN, state: 'waiting', waiting: { reason: 'permission', detail: 'Bash · npm run build' },
  turns: [
    { index: 1, start: 0, end: 2 * MIN, prompt: 'Corrige le test', live: false, steps: [
      { id: 'r1', name: 'Read', kind: 'read', label: 'a.ts', start: 0, end: 1000, error: false, agent: null },
      { id: 'b1', name: 'Bash', kind: 'command', label: 'npm test', start: 2000, end: 40_000, error: true, agent: null },
    ] },
    { index: 2, start: 90 * MIN, end: 100 * MIN, prompt: 'Ajoute un onglet', live: true, steps: [
      { id: 't1', name: 'Task', kind: 'agent', label: 'explorer', start: 90 * MIN, end: 95 * MIN, error: false,
        agent: { id: 'x', name: 'Explore', description: 'explorer le code', state: 'done', steps: [{ id: 'g1', name: 'Grep', kind: 'other', label: 'timeline', start: 91 * MIN, end: 91 * MIN + 500, error: false }] } },
    ] },
  ],
};

function render() {
  const sessionLog = vi.fn(async () => ({ entries: [
    { id: 'S:1', ts: 2000, kind: 'tool', title: 'Bash · npm test', text: '{ "command": "npm test" }', truncated: false, agent: 'Agent principal', sub: false, ref: 'b1' },
    { id: 'S:2', ts: 40_000, kind: 'error', title: 'Bash', text: 'FAIL a.spec.ts', truncated: false, agent: 'Agent principal', sub: false, ref: 'b1' },
  ] }));
  TestBed.configureTestingModule({ providers: [provideVigieServiceMock({
    traceResource: (() => fakeResource(TRACE)) as unknown as VigieService['traceResource'],
    sessionLog: sessionLog as unknown as VigieService['sessionLog'],
  })] });
  const fixture = TestBed.createComponent(TimelineComponent);
  fixture.componentRef.setInput('sessionId', 'S');
  fixture.componentRef.setInput('lastTs', 1);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('TimelineComponent', () => {
  it('liste les tours du plus récent au plus ancien, seul le tour en cours est déplié', () => {
    const { el } = render();
    const heads = [...el.querySelectorAll('.turn-head')];
    expect(heads.map((h) => h.querySelector('.turn-no')!.textContent)).toEqual(['Tour 2', 'Tour 1']);
    expect(heads.map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    expect(heads[1].textContent).toContain('1 erreur');
    // Tour en cours : sous-agent et attente visibles.
    const live = el.querySelector('#turn-2')!;
    expect(live.textContent).toContain('Explore · explorer le code');
    expect(live.querySelector('.waiting')!.textContent).toContain('Bash · npm run build');
    // Gantt : couloir principal + un couloir pour Explore, repères T1 / T2, coupure des 88 min, attente en ambre.
    expect([...el.querySelectorAll('app-gantt .head')].map((h) => h.textContent!.trim())).toEqual(['Principal', 'Explore']);
    expect([...el.querySelectorAll('app-gantt .lbl.turn')].map((b) => b.textContent!.trim())).toEqual(['T1', 'T2']);
    expect(el.querySelector('app-gantt .axis')!.textContent).toContain('⋯ 1 h 28 ⋯');
    expect(el.querySelector('app-gantt .wait')).not.toBeNull();
    // Une seule barre dans l'ordre de tabulation, libellé complet pour le lecteur d'écran.
    const bars = [...el.querySelectorAll<HTMLButtonElement>('app-gantt .b')];
    expect(bars.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(bars.map((b) => b.getAttribute('aria-label'))).toContain('Commande npm test, 38 s, erreur, tour 1');
  });

  it("clic sur une barre du Gantt : déplie le tour et sélectionne l'étape dans la cascade", async () => {
    const { fixture, el } = render();
    [...el.querySelectorAll<HTMLButtonElement>('app-gantt .b')].find((b) => b.getAttribute('aria-label')!.startsWith('Commande'))!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('#turn-1 .turn-head')!.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('#turn-1 .step.selected')!.textContent).toContain('npm test');
    expect(el.querySelector('#turn-1 app-step-detail')!.textContent).toContain('FAIL a.spec.ts');
  });

  it("déplie un sous-agent, puis ouvre le détail d'une étape avec ses paramètres et son erreur", async () => {
    const { fixture, el } = render();
    el.querySelector<HTMLButtonElement>('#turn-2 .twist[aria-expanded]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('#turn-2')!.textContent).toContain('Grep');

    el.querySelectorAll<HTMLButtonElement>('.turn-head')[1].click();
    fixture.detectChanges();
    const bash = [...el.querySelectorAll<HTMLButtonElement>('#turn-1 .pick')].find((b) => b.textContent!.includes('Bash'))!;
    bash.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const detail = el.querySelector('#turn-1 app-step-detail')!;
    expect(detail.textContent).toContain('npm test');
    expect(detail.textContent).toContain('FAIL a.spec.ts');
    expect(detail.querySelector('h4.text-err')!.textContent).toContain('Erreur');
  });

  it('erreurs seules : ne garde que les tours et étapes en erreur', () => {
    const { fixture, el } = render();
    [...el.querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent!.includes('Erreurs'))!.click();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.turn-no')].map((n) => n.textContent)).toEqual(['Tour 1']);
    expect([...el.querySelectorAll('#turn-1 .step .name')].map((n) => n.textContent!.trim())).toEqual(['Bash']);
  });
});
