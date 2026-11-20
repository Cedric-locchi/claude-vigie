import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../../core/models';
import { anAgent } from '../../../../core/vigie.service.mock';
import { AgentRowComponent } from './agent-row.component';

const base = anAgent({ id: 'a', name: 'test-runner', sub: true, description: '', state: 'running', lastAction: 'Bash · npm test', lastText: '', tokens: 37_000, toolCount: 4, firstTs: 0, lastTs: 300_000 });

function render(agent: Partial<Agent>) {
  const fixture = TestBed.createComponent(AgentRowComponent);
  fixture.componentRef.setInput('agent', { ...base, ...agent });
  fixture.detectChanges();
  return fixture;
}

describe('AgentRowComponent', () => {
  it("barre d'état selon l'état ; un souci passe avant", () => {
    const state = (a: Partial<Agent>) => (render(a).nativeElement as HTMLElement).querySelector('.row')!.getAttribute('data-state');
    expect(state({})).toBe('running');
    expect(state({ state: 'waiting', reason: 'permission' })).toBe('waiting');
    expect(state({ state: 'done', issue: '2 tests rouges' })).toBe('issue');
  });

  it('toute la ligne est un bouton qui ouvre le détail', () => {
    const fixture = render({ state: 'waiting', reason: 'permission', detail: 'Bash · rm -rf dist' });
    const open = vi.fn();
    fixture.componentInstance.open.subscribe(open);
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Bash · rm -rf dist');
    buttons[0].click();
    expect(open).toHaveBeenCalled();
  });

  it("montre sa mission plutôt que la commande en cours ; la commande sinon", () => {
    const el = render({ description: 'Dev front pan 2a' }).nativeElement as HTMLElement;
    expect(el.querySelector('.mission')?.textContent).toBe('Dev front pan 2a');
    expect(el.textContent).not.toContain('npm test');
    expect((render({}).nativeElement as HTMLElement).textContent).toContain('Bash · npm test');
    // Agent principal : sa mission, on la connaît ; on garde la commande.
    expect((render({ sub: false, description: 'Mon prompt' }).nativeElement as HTMLElement).textContent).toContain('Bash · npm test');
  });
});
