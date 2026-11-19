import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskLauncherComponent } from './task-launcher.component';
import type { LauncherTask, TaskTheme } from './task-launcher.vm';

const THEMES: TaskTheme[] = [
  { id: 'dev', label: 'Développement', tasks: [{ id: 'dev', name: 'dev', command: 'vite' }, { id: 'w/start', name: 'start', scope: '@app/api', hint: 'Démarre l’API', command: 'node api' }] },
  { id: 'lifecycle', label: 'Cycle de vie', tasks: [{ id: 'prepare', name: 'prepare', command: 'husky' }] },
  { id: 'other', label: 'Autres', tasks: [{ id: 'x', name: 'lint:fix', disabledReason: 'Non lançable' }] },
];

@Component({
  imports: [TaskLauncherComponent],
  template: `
    <vigie-task-launcher heading="Scripts npm" source="npm · package-lock.json" [themes]="themes()" [launching]="launching()" storageKey="spec"
                         [collapsedByDefault]="['lifecycle']" (run)="runs.push($event)" (refresh)="refreshes = refreshes + 1">
      <p note>Attention</p>
      <p empty>Rien ici</p>
    </vigie-task-launcher>
  `,
})
class Host {
  readonly themes = signal<TaskTheme[]>(THEMES);
  readonly launching = signal<string | null>(null);
  runs: LauncherTask[] = [];
  refreshes = 0;
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const toggles = () => [...el.querySelectorAll<HTMLButtonElement>('.toggle')];
  const go = () => [...el.querySelectorAll<HTMLButtonElement>('button.go')];
  const search = () => el.querySelector<HTMLInputElement>('input[type="search"]')!;
  return { fixture, el, host: fixture.componentInstance, toggles, go, search };
}

afterEach(() => localStorage.clear());

describe('TaskLauncherComponent', () => {
  it('h2, provenance, encadré des avertissements, panneaux avec aria-expanded / aria-controls', () => {
    const { el, toggles } = render();
    expect(el.querySelector('h2')!.textContent).toBe('Scripts npm');
    expect(el.querySelector('.bar')!.textContent).toContain('npm · package-lock.json');
    expect(el.querySelector('.notes')!.textContent).toBe('Attention');
    expect(el.textContent).not.toContain('Rien ici');
    expect(toggles().map((b) => [b.querySelector('.label')!.textContent, b.getAttribute('aria-expanded')])).toEqual([['Développement', 'true'], ['Cycle de vie', 'false'], ['Autres', 'true']]);
    const list = el.querySelector<HTMLElement>('#' + toggles()[1].getAttribute('aria-controls'))!;
    expect(list.hidden).toBe(true);
  });

  it('replier / déplier au clic, mémorisé pour la même clé', () => {
    let r = render();
    r.toggles()[0].click();
    r.fixture.detectChanges();
    expect(r.toggles()[0].getAttribute('aria-expanded')).toBe('false');
    r.fixture.destroy();
    r = render();
    expect(r.toggles()[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('un bouton « Lancer » par tâche, libellé avec le workspace ; non lançable = aria-disabled + raison', () => {
    const { go, host, el } = render();
    expect(go().map((b) => b.getAttribute('aria-label'))).toEqual(['Lancer dev', 'Lancer start dans @app/api', 'Lancer prepare', 'Lancer lint:fix']);
    const off = go()[3];
    expect([off.disabled, off.getAttribute('aria-disabled')]).toEqual([false, 'true']);
    expect(el.querySelector('#' + off.getAttribute('aria-describedby'))!.textContent).toBe('Non lançable');
    off.click();
    go()[1].click();
    expect(host.runs.map((t) => t.id)).toEqual(['w/start']);
  });

  it('pendant un lancement : boutons aria-disabled mais jamais disabled, ligne lancée marquée, clic ignoré', () => {
    const { fixture, go, host, el } = render();
    host.launching.set('dev');
    fixture.detectChanges();
    expect(go().every((b) => !b.disabled && b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(el.querySelector('li.busy')!.textContent).toContain('Ouverture…');
    go()[1].click();
    expect(host.runs).toEqual([]);
  });

  it('recherche : ouvre les thèmes correspondants, indice Entrée, « Entrée » lance la première tâche visible', () => {
    const { fixture, search, toggles, host, el } = render();
    search().value = 'husky';
    search().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(toggles().map((b) => b.getAttribute('aria-expanded'))).toEqual(['true']);
    expect(el.querySelector('.enter')!.textContent).toContain('lance prepare');
    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.runs.map((t) => t.id)).toEqual(['prepare']);
  });

  it('« / » met le focus dans la recherche, sauf depuis un champ', () => {
    const { search } = render();
    const other = document.createElement('textarea');
    document.body.append(other);
    other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(other);
    other.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(search());
    other.remove();
  });

  it('aucun thème : contenu « empty » ; Rafraîchir émet', () => {
    const { fixture, host, el } = render();
    host.themes.set([]);
    fixture.detectChanges();
    expect(el.textContent).toContain('Rien ici');
    el.querySelector<HTMLButtonElement>('.refresh')!.click();
    expect(host.refreshes).toBe(1);
  });

  it('pas de défilement propre : c’est l’onglet qui défile', () => {
    const { el } = render();
    const scrollers = [...el.querySelectorAll('*')].filter((n) => /auto|scroll/.test(getComputedStyle(n).overflowY));
    expect(scrollers).toEqual([]);
  });
});
