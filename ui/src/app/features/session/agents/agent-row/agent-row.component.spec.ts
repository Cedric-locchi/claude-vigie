import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../../core/models';
import { AgentRowComponent } from './agent-row.component';

const base: Agent = { id: 'a', name: 'test-runner', sub: true, description: '', state: 'running', lastAction: 'Bash · npm test', lastText: '', tokens: 37_000, toolCount: 4, firstTs: 0, lastTs: 300_000, bars: [] };

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
});
