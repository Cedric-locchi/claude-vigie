import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anAgent, provideVigieServiceMock } from '../../../../core/vigie.service.mock';
import { LogEntry } from '../../../../core/models';
import { Agent } from '../../../../core/models';
import { AgentPanelComponent } from './agent-panel.component';

const agent = (extra: Partial<Agent>): Agent => anAgent({ id: 'a1', name: 'testeur', sub: true, state: 'done', tokens: 0, toolCount: 0, firstTs: 0, lastTs: 0, ...extra });

const entry = (n: number, extra: Partial<LogEntry>): LogEntry => ({
  id: `a1:${n}`, ts: n * 1000, kind: 'assistant', title: 'Claude', text: '', truncated: false, agent: 'testeur', sub: true, ...extra,
});

describe('AgentPanelComponent', () => {
  const sessionLog = vi.fn();
  beforeEach(() => {
    sessionLog.mockResolvedValue({ entries: [] });
    TestBed.configureTestingModule({ providers: [provideVigieServiceMock({ sessionLog })] });
  });

  it("ne montre que ce que l'agent dit, le code qu'il écrit et ses erreurs", async () => {
    sessionLog.mockResolvedValue({ entries: [
      entry(1, { text: 'Je regarde **le module**' }),
      entry(2, { kind: 'tool', title: 'Read · a.ts', text: '{"file_path":"a.ts"}' }),
      entry(3, { kind: 'tool', title: 'Edit · a.ts', text: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'const y = 2;' }) }),
      entry(4, { kind: 'error', title: 'Bash', text: 'exit 1' }),
      entry(5, { kind: 'result', title: 'Read', text: 'contenu lu' }),
      { ...entry(6, { text: "message d'un autre agent" }), id: 'b2:0' },
    ] });
    const fixture = TestBed.createComponent(AgentPanelComponent);
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('agent', agent({}));
    await fixture.whenStable();
    await fixture.whenStable();
    const text = document.body.textContent!;
    expect(sessionLog).toHaveBeenCalledWith('s1', 0);
    expect(document.body.querySelector('.entry .markdown strong')?.textContent).toBe('le module');
    expect(document.body.querySelector('.entry .code')?.textContent).toBe('exit 1'); // le plus récent en haut
    expect(text).toContain('const y = 2;');
    expect(text).not.toContain('old_string');
    expect(text).not.toContain('Read · a.ts');
    expect(text).not.toContain('contenu lu');
    expect(text).not.toContain('autre agent');
  });

  it('affiche le brief du sous-agent à part et les consignes suivantes dans le fil', async () => {
    sessionLog.mockResolvedValue({ entries: [
      entry(1, { kind: 'prompt', title: 'Consigne', text: 'Ajoute **les tests**' }),
      entry(2, { text: 'Tests ajoutés' }),
      entry(3, { kind: 'prompt', title: 'Consigne', text: 'Et la doc' }),
    ] });
    const fixture = TestBed.createComponent(AgentPanelComponent);
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('agent', agent({ sub: true }));
    await fixture.whenStable();
    await fixture.whenStable();
    const sections = [...document.body.querySelectorAll('section')];
    const brief = sections.find((s) => s.querySelector('h3')?.textContent === 'Brief');
    expect(brief?.querySelector('strong')?.textContent).toBe('les tests');
    const feed = sections.find((s) => s.querySelector('h3')?.textContent === "Fil de l'agent")!.textContent!;
    expect(feed).toContain('Et la doc');
    expect(feed).toContain('Tests ajoutés');
    expect(feed).not.toContain('les tests');
  });

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
