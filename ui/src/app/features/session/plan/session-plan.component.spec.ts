import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { SessionPlan } from '../../../core/models';
import { aPlan, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionPlanComponent } from './session-plan.component';

function render(res = fakeResource<SessionPlan | undefined>(aPlan())) {
  TestBed.configureTestingModule({ providers: [provideVigieServiceMock({ planResource: () => res })] });
  const fixture = TestBed.createComponent(SessionPlanComponent);
  fixture.componentRef.setInput('sessionId', 's1');
  fixture.componentRef.setInput('planTs', 50_000);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, res };
}

describe('SessionPlanComponent', () => {
  it('affiche le plan rendu dans un article', () => {
    const { el } = render();
    expect(el.querySelector('article.markdown h1')?.textContent).toBe('Plan');
    expect(el.querySelector('time')).not.toBeNull();
  });

  it('erreur : message et bouton Réessayer', () => {
    const { el, res } = render(fakeResource<SessionPlan | undefined>(undefined, 'error', new HttpErrorResponse({ status: 0 })));
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('article')).toBeNull();
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Réessayer'))!.click();
    expect(res.reload).toHaveBeenCalled();
  });
});
