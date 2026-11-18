import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Agent } from '../../../../core/models';
import { AgentPanelComponent } from './agent-panel.component';

const agent = (extra: Partial<Agent>): Agent => ({
  id: 'a1', name: 'testeur', sub: true, description: '', state: 'done', lastAction: null, lastText: '',
  tokens: 0, toolCount: 0, firstTs: 0, lastTs: 0, bars: [], ...extra,
});

describe('AgentPanelComponent', () => {
  it('affiche le rapport d’un agent terminé en markdown formaté, sans script', async () => {
    const fixture = TestBed.createComponent(AgentPanelComponent);
    fixture.componentRef.setInput('agent', agent({ lastText: '## Tests ajoutés\n\n| Fichier | Statut |\n|---|---|\n| `a.spec.ts` | **ok** |\n\n<img src=x onerror="alert(1)">' }));
    await fixture.whenStable();
    const root = document.body; // le panneau est rendu dans un overlay
    expect(root.textContent).toContain('Rapport');
    const md = root.querySelector('.markdown')!;
    expect(md.querySelector('h2')?.textContent).toBe('Tests ajoutés');
    expect(md.querySelector('td code')?.textContent).toBe('a.spec.ts');
    expect(md.innerHTML).not.toContain('onerror');
  });

  it('signale un message coupé par le daemon, et seulement alors', async () => {
    const fixture = TestBed.createComponent(AgentPanelComponent);
    fixture.componentRef.setInput('agent', agent({ lastText: 'Début du rapport', lastTextTruncated: true }));
    await fixture.whenStable();
    expect(document.body.querySelector('.truncated')?.textContent).toContain('coupé à 20 000 caractères');
    fixture.componentRef.setInput('agent', agent({ lastText: 'Court', lastTextTruncated: false }));
    await fixture.whenStable();
    expect(document.body.querySelector('.truncated')).toBeNull();
  });
});
