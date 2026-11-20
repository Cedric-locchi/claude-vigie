import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { SessionPlan } from '../../../core/models';
import { aPlan, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionPlanVm } from './session-plan.vm';

function createVm(res = fakeResource<SessionPlan | undefined>(aPlan({ ts: 0 }))) {
  TestBed.configureTestingModule({ providers: [SessionPlanVm, provideVigieServiceMock({ planResource: () => res })] });
  const vm = TestBed.inject(SessionPlanVm);
  vm.connect(signal('s1'), signal(0));
  return vm;
}

describe('SessionPlanVm', () => {
  it('rend le plan en Markdown, avec son ancienneté selon l’horloge du daemon', () => {
    const vm = createVm(fakeResource<SessionPlan | undefined>(aPlan({ ts: 0 })));
    expect(vm.html()).toContain('<h1');
    expect(vm.html()).toContain('<ol>');
    expect(vm.age()).toBe('il y a 2 min'); // aSnapshot : now = 120 000
    expect(vm.error()).toBeNull();
  });

  it('daemon injoignable : pas de plan, un message, sans exception', () => {
    const vm = createVm(fakeResource<SessionPlan | undefined>(undefined, 'error', new HttpErrorResponse({ status: 0 })));
    expect(vm.plan()).toBeNull();
    expect(vm.html()).toBeNull();
    expect(vm.error()).toMatch(/daemon/i);
  });

  it('erreur du daemon (404) : son message', () => {
    const vm = createVm(fakeResource<SessionPlan | undefined>(undefined, 'error', new HttpErrorResponse({ status: 404, error: { error: 'aucun plan' } })));
    expect(vm.error()).toBe('Aucun plan');
  });
});
