import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { aConfig, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { VigieService } from '../../../core/vigie.service';
import { ClaudeConfig } from '../../../core/models';
import { SessionConfigComponent } from './session-config.component';

function render(skills: ClaudeConfig['skills'] = [{ scope: 'projet', name: 'revue', description: '', path: '~/dev/revu/.claude/skills/revue/SKILL.md' }]) {
  const config = aConfig({ skills, env: [{ scope: 'utilisateur', name: 'GITHUB_TOKEN' }] });
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideVigieServiceMock({ configResource: (() => fakeResource(config)) as unknown as VigieService['configResource'] })] });
  const fixture = TestBed.createComponent(SessionConfigComponent);
  fixture.componentRef.setInput('sessionId', 's1');
  fixture.componentRef.setInput('cwd', '/dev/revu');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const open = (label: string) => {
    [...el.querySelectorAll<HTMLButtonElement>('.nav-item')].find((b) => b.textContent!.includes(label))!.click();
    fixture.detectChanges();
  };
  return { el, open, fixture };
}

describe('SessionConfigComponent', () => {
  it("résume l'état en une ligne et ouvre « À corriger » quand il y a un problème", () => {
    const { el } = render();
    expect(el.querySelector('.health')!.textContent).toContain('1 erreur');
    expect(el.querySelector('.nav-item[aria-current=page]')!.textContent).toContain('À corriger');
    expect(el.querySelector('.pane .issue[data-level=error]')!.textContent).toContain('description manquante');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent!.includes('Audit approfondi'))).toBe(true);
  });

  it('une rubrique à la fois, chaque élément avec ses propres problèmes', () => {
    const { el, open } = render();
    open('Skills');
    const row = el.querySelector('.pane .row')!;
    expect(row.textContent).toContain('revue');
    expect(row.textContent).toContain('Pas de description');
    expect(row.querySelector('.row-issue[data-level=error]')!.textContent).toContain('description manquante');
    // Le problème est rattaché à la skill : il ne s'affiche pas une seconde fois en tête de rubrique.
    expect(el.querySelectorAll('.pane .issue')).toHaveLength(0);
    open('Permissions');
    // Permissions groupées par outil ; la règle complète reste en infobulle.
    expect([...el.querySelectorAll('app-config-permissions summary .g-name')].map((n) => n.textContent)).toEqual(['Bash', 'Read']);
    expect(el.querySelector('.rule .detail[title="Read(./.env*)"]')).not.toBeNull();
    expect(el.querySelector('.pane')!.textContent).not.toContain('revue');
    open('Environnement');
    expect(el.querySelector('.pane')!.textContent).toContain('GITHUB_TOKEN');
  });

  it('accordéon : replié, le nom seul ; déplié, la description et le markdown rendu', () => {
    const { el, open, fixture } = render([{ scope: 'projet', name: 'revue', description: 'Relit le diff', path: '~/s/SKILL.md', body: '# Étapes\n\n1. lire' }]);
    open('Skills');
    const details = el.querySelector<HTMLDetailsElement>('.pane .row details')!;
    expect(details.textContent).toContain('revue');
    expect(details.textContent).not.toContain('Relit le diff');
    expect(details.querySelector('.markdown')).toBeNull();
    details.open = true;
    details.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }));
    fixture.detectChanges();
    expect(details.textContent).toContain('Relit le diff');
    expect(details.querySelector('.markdown h1')!.textContent).toBe('Étapes');
  });
});
