import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../../core/models';
import { AgentCardComponent } from './agent-card.component';

const base: Agent = { id: 'a', name: 'test-runner', sub: true, description: 'tests unitaires', state: 'done', lastAction: 'Bash · swift test', lastText: 'Fini.', tokens: 37_000, toolCount: 4, firstTs: 0, lastTs: 300_000, bars: [] };

function render(agent: Partial<Agent>, canAnswer = false) {
  const fixture = TestBed.createComponent(AgentCardComponent);
  fixture.componentRef.setInput('agent', { ...base, ...agent });
  fixture.componentRef.setInput('canAnswer', canAnswer);
  fixture.detectChanges();
  return fixture;
}

describe('AgentCardComponent', () => {
  it('montre un souci en priorité sur « terminé »', () => {
    const el: HTMLElement = render({ issue: '2 snapshots obsolètes' }).nativeElement;
    expect(el.querySelector('[hlmBadge]')!.textContent).toBe('Souci');
    expect(el.textContent).toContain('2 snapshots obsolètes');
    expect(el.textContent).toContain('37 k tok');
  });

  it("propose les réponses rapides quand l'agent attend une autorisation", () => {
    const fixture = render({ sub: false, state: 'waiting', reason: 'permission', detail: 'Bash · xcodebuild test' }, true);
    const refuse = vi.fn();
    fixture.componentInstance.refuse.subscribe(refuse);
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Autoriser', 'Refuser', 'Aller au terminal']);
    (fixture.nativeElement as HTMLElement).querySelectorAll('button')[1].click();
    expect(refuse).toHaveBeenCalled();
  });

  it('le badge dit la raison de l’attente', () => {
    const badge = (a: Partial<Agent>) => (render(a).nativeElement as HTMLElement).querySelector('[hlmBadge]')!.textContent;
    expect(badge({ state: 'waiting', reason: 'permission' })).toBe('Autorisation');
    expect(badge({ state: 'waiting', reason: 'question' })).toBe('Question');
    expect(badge({ state: 'done' })).toBe('Terminé');
  });

  it('affiche la question posée', () => {
    const el: HTMLElement = render({ state: 'waiting', reason: 'question', detail: 'Imports ou nommage ?' }).nativeElement;
    expect(el.textContent).toContain('Imports ou nommage ?');
    expect(el.querySelector('button')).toBeNull();
  });
});
