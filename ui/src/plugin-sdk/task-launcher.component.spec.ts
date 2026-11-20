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
                         (run)="runs.push($event)" (refresh)="refreshes = refreshes + 1">
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
  const nav = () => [...el.querySelectorAll<HTMLButtonElement>('.nav-item')];
  const go = () => [...el.querySelectorAll<HTMLButtonElement>('button.go')];
  const search = () => el.querySelector<HTMLInputElement>('input[type="search"]')!;
  return { fixture, el, host: fixture.componentInstance, nav, go, search };
}

afterEach(() => localStorage.clear());

describe('TaskLauncherComponent', () => {
  it('h2, provenance, encadré des avertissements, un thème par entrée de navigation, le premier affiché', () => {
    const { el, nav } = render();
    expect(el.querySelector('h2')!.textContent).toBe('Scripts npm');
    expect(el.querySelector('.head')!.textContent).toContain('npm · package-lock.json');
    expect(el.querySelector('.notes')!.textContent).toBe('Attention');
    expect(el.textContent).not.toContain('Rien ici');
    expect(nav().map((b) => [b.querySelector('.label')!.textContent, b.getAttribute('aria-current')])).toEqual([['Développement', 'page'], ['Cycle de vie', null], ['Autres', null]]);
    expect(el.querySelector('h3')!.textContent).toBe('Développement');
  });

  it('choisir un thème l’affiche, mémorisé pour la même clé', () => {
    let r = render();
    r.nav()[2].click();
    r.fixture.detectChanges();
    expect([r.nav()[2].getAttribute('aria-current'), r.el.querySelector('h3')!.textContent]).toEqual(['page', 'Autres']);
    r.fixture.destroy();
    r = render();
    expect(r.el.querySelector('h3')!.textContent).toBe('Autres');
  });

  it('un bouton « Lancer » par tâche, libellé avec le workspace ; non lançable = aria-disabled + raison', () => {
    const { go, host, el, nav, fixture } = render();
    expect(go().map((b) => b.getAttribute('aria-label'))).toEqual(['Lancer dev', 'Lancer start dans @app/api']);
    go()[1].click();
    nav()[2].click();
    fixture.detectChanges();
    const off = go()[0];
    expect([off.getAttribute('aria-label'), off.disabled, off.getAttribute('aria-disabled')]).toEqual(['Lancer lint:fix', false, 'true']);
    expect(el.querySelector('#' + off.getAttribute('aria-describedby'))!.textContent).toBe('Non lançable');
    off.click();
    off.closest('li')!.click();
    expect(host.runs.map((t) => t.id)).toEqual(['w/start']);
  });

  it('un clic n’importe où sur la ligne lance la tâche, une seule fois', () => {
    const { el, go, host } = render();
    el.querySelector<HTMLElement>('li .cmd')!.click();
    go()[1].click();
    expect(host.runs.map((t) => t.id)).toEqual(['dev', 'w/start']);
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

  it('recherche : la navigation ne garde que les thèmes correspondants, indice Entrée, « Entrée » lance la première tâche', () => {
    const { fixture, search, nav, host, el } = render();
    search().value = 'husky';
    search().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(nav().map((b) => b.querySelector('.label')!.textContent)).toEqual(['Cycle de vie']);
    expect(el.querySelector('.enter')!.textContent).toContain('lance prepare');
    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.runs.map((t) => t.id)).toEqual(['prepare']);
    search().value = 'zzz';
    search().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('.pane')!.textContent).toContain('Aucune tâche ne contient « zzz »');
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

  it('deux panneaux qui défilent chacun : navigation et contenu', () => {
    const { el } = render();
    const scrollers = [...el.querySelectorAll('*')].filter((n) => /auto|scroll/.test(getComputedStyle(n).overflowY)).map((n) => n.className);
    expect(scrollers).toEqual(['nav panel', 'pane panel']);
  });
});
