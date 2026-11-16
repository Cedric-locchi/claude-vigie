import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { provideVigieServiceMock } from '../../core/vigie.service.mock';
import { NewSessionComponent } from './new-session.component';
import { NewSessionVm } from './new-session.vm';

// VM réel + service mocké : le composant n'est qu'un relais de formulaire.
function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideVigieServiceMock()] });
  const fixture = TestBed.createComponent(NewSessionComponent);
  fixture.detectChanges();
  const vm = fixture.debugElement.injector.get(NewSessionVm);
  return { fixture, el: fixture.nativeElement as HTMLElement, vm };
}

describe('NewSessionComponent', () => {
  it('liste les projets récents dans le formulaire, le plus récent choisi par défaut', () => {
    const { el } = render();
    const opts = [...el.querySelectorAll('#ns-dir-list [role=option]')];
    expect(opts.map((o) => o.querySelector('.name')!.textContent!.trim())).toEqual(['meeplebox', 'vigie', 'ui', 'notes']);
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    expect(opts[0].textContent).toContain('iOS');
    expect(opts[0].textContent).toContain('feat/suggestions');
    expect(el.querySelector('#ns-dir')!.getAttribute('aria-activedescendant')).toBe('ns-dir-opt-0');
    expect(el.querySelector<HTMLInputElement>('#ns-cmd')!.value).toBe('claude --model opus');
  });

  it("app de bureau : pas de liste, cliquer le champ ouvre le sélecteur natif comme le bouton", async () => {
    const pickFolder = vi.fn(async (): Promise<string | null> => '/Users/moi/dev/app');
    (globalThis as { vigieDesktop?: unknown }).vigieDesktop = { pickFolder };
    try {
      const { fixture, el, vm } = render();
      expect(el.querySelector('#ns-dir-list')).toBeNull();
      const input = el.querySelector<HTMLInputElement>('#ns-dir')!;
      expect(input.readOnly).toBe(true);
      input.click();
      await fixture.whenStable();
      expect(pickFolder).toHaveBeenCalledTimes(1);
      expect(vm.model().cwd).toBe('/Users/moi/dev/app');
    } finally {
      delete (globalThis as { vigieDesktop?: unknown }).vigieDesktop;
    }
  });

  it('dossier : surligne la recherche et explique une liste vide', () => {
    const { fixture, el, vm } = render();
    const input = el.querySelector<HTMLInputElement>('#ns-dir')!;
    input.value = 'meep';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('#ns-dir-list mark')!.textContent).toBe('meep');
    expect(vm.model().cwd).toBe('meep');
    vm.setQuery('zzz');
    fixture.detectChanges();
    expect(el.querySelector('[role=status]')!.textContent).toContain('Aucun dossier récent ne correspond');
  });

  it('modèle et autorisations : Select spartan reliés au formulaire, avec les libellés', () => {
    const { fixture, el, vm } = render();
    expect(el.querySelector('#ns-model')!.textContent).toContain('Opus');
    vm.model.update((m) => ({ ...m, model: 'sonnet', permission: 'plan' }));
    fixture.detectChanges();
    expect(el.querySelector('#ns-model')!.textContent).toContain('Sonnet');
    expect(el.querySelector('#ns-perm')!.textContent).toContain("Mode plan d'abord");
    expect(el.querySelector<HTMLInputElement>('#ns-cmd')!.value).toBe('claude --model sonnet --permission-mode plan');
  });

  it('git : nouvelle branche affiche le champ et préfixe la commande', () => {
    const { fixture, el, vm } = render();
    expect(el.querySelector('#ns-branch')).toBeNull();
    [...el.querySelectorAll<HTMLButtonElement>('[hlmToggleGroupItem]')].find((b) => b.textContent!.includes('Nouvelle branche'))!.click();
    fixture.detectChanges();
    expect(vm.model().git).toBe('branch');
    const input = el.querySelector<HTMLInputElement>('#ns-branch')!;
    input.value = 'feat/x';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('#ns-cmd')!.value).toMatch(/^git switch -c 'feat\/x' && claude /);
  });

  it('met à jour la commande quand on choisit un gabarit', () => {
    const { fixture, el, vm } = render();
    [...el.querySelectorAll<HTMLButtonElement>('[hlmToggleGroupItem]')].find((b) => b.textContent!.includes('Relecture'))!.click();
    fixture.detectChanges();
    expect(vm.model().template).toBe('review');
    expect(el.querySelector<HTMLInputElement>('#ns-cmd')!.value).toContain('Relis le diff');
  });

  it('lance la session à la soumission', () => {
    const { el, vm } = render();
    const launch = vi.spyOn(vm, 'launch').mockResolvedValue();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(launch).toHaveBeenCalled();
  });

  it('gabarit « Aucun » : sélectionnable après un autre gabarit, le prompt disparaît', () => {
    const { fixture, el, vm } = render();
    const item = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('[hlmToggleGroupItem]')].find((b) => b.textContent!.includes(label))!;
    item('Relecture').click();
    fixture.detectChanges();
    expect(vm.model().template).toBe('review');
    item('Aucun').click();
    fixture.detectChanges();
    expect(vm.model().template).toBe('');
    expect(el.querySelector<HTMLInputElement>('#ns-cmd')!.value).not.toContain('Relis le diff');
  });
});
