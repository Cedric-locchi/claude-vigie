import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { TerminalComponent } from './terminal.component';
import { TerminalVm } from './terminal.vm';

function render(status: 'open' | 'closed') {
  const vm = { status: signal(status), attach: vi.fn(), fit: vi.fn(), repaint: vi.fn(), focus: vi.fn(), dispose: vi.fn() };
  TestBed.overrideComponent(TerminalComponent, { set: { providers: [{ provide: TerminalVm, useValue: vm }] } });
  const fixture = TestBed.createComponent(TerminalComponent);
  fixture.componentRef.setInput('terminalId', 't1');
  fixture.detectChanges();
  return { fixture, vm };
}

describe('TerminalComponent', () => {
  it('attache le terminal au rendu et le libère à la destruction', async () => {
    const { fixture, vm } = render('open');
    await fixture.whenStable();
    expect(vm.attach).toHaveBeenCalledWith(expect.any(HTMLElement), 't1');
    fixture.destroy();
    expect(vm.dispose).toHaveBeenCalled();
  });

  it('signale une connexion perdue', () => {
    expect((render('closed').fixture.nativeElement as HTMLElement).textContent).toContain('Connexion au terminal perdue');
  });

  it('focusTick redonne le focus au terminal actif, même déjà actif', async () => {
    const { fixture, vm } = render('open');
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(r));
    vm.focus.mockClear();
    fixture.componentRef.setInput('focusTick', 1);
    fixture.detectChanges();
    await new Promise((r) => requestAnimationFrame(r));
    expect(vm.focus).toHaveBeenCalled();
    expect(vm.repaint).toHaveBeenCalled();
  });
});
