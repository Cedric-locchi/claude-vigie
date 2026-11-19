import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { CLIENT_OS } from '../../../core/platform';
import { aProjectFiles, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionFilesComponent } from './session-files.component';

function render(extra: Parameters<typeof provideVigieServiceMock>[0] = {}) {
  ['side', 'collapsed'].forEach((k) => localStorage.removeItem(`vigie.files.${k}`));
  TestBed.configureTestingModule({ providers: [provideConfirmServiceMock(), provideVigieServiceMock(extra), { provide: CLIENT_OS, useValue: 'linux' }] });
  const fixture = TestBed.createComponent(SessionFilesComponent);
  fixture.componentRef.setInput('sessionId', 's1');
  fixture.componentRef.setInput('idle', true);
  const el = fixture.nativeElement as HTMLElement;
  document.body.append(el); // focus : seulement dans le document
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  const type = async (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); await settle(); };
  const press = async (target: Element, key: string, init: KeyboardEventInit = {}) => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })); await settle(); };
  const rows = () => [...el.querySelectorAll<HTMLElement>('[role=tree][aria-label="Fichiers du projet"] [role=treeitem]')];
  const row = (path: string) => el.querySelector<HTMLElement>(`[role=tree][aria-label="Fichiers du projet"] [data-path="${path}"]`)!;
  const current = () => el.querySelector('.tab-name[aria-current=page]')?.closest('.tab');
  const btn = (label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  return { fixture, el, settle, type, press, rows, row, current, btn };
}

describe('SessionFilesComponent', () => {
  afterEach(() => { document.body.innerHTML = ''; ['side', 'collapsed'].forEach((k) => localStorage.removeItem(`vigie.files.${k}`)); });

  it('vue Projet : arbre avec icônes de type, dépliage, onglet d’aperçu puis gardé ; barre d’état', async () => {
    const { el, settle, rows, current } = render({ files: async () => aProjectFiles({ truncated: true }) });
    await settle();

    expect(el.querySelector('.tw-title')!.textContent).toBe('Projet');
    expect(el.textContent).toContain('liste est incomplète');
    expect(rows().map((r) => r.querySelector('.name')!.textContent)).toEqual(['node_modules', 'src', '.env', 'README.md']);
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]); // roving tabindex
    expect(rows()[3].querySelector('app-file-icon')!.getAttribute('data-glyph')).toBe('md');
    rows()[1].click();
    await settle();
    expect(rows()[1].getAttribute('aria-expanded')).toBe('true');

    rows().find((r) => r.querySelector('.name')!.textContent === 'a.ts')!.click();
    await settle();
    expect(current()!.querySelector('.tn')!.textContent).toBe('a.ts');
    expect(current()!.classList).toContain('preview');
    expect(current()!.querySelector('app-file-icon')!.getAttribute('data-glyph')).toBe('ts');
    current()!.dispatchEvent(new MouseEvent('dblclick'));
    await settle();
    expect(current()!.classList).not.toContain('preview');
    expect(el.querySelector<HTMLTextAreaElement>('app-code-editor textarea')!.readOnly).toBe(true);
    const status = el.querySelector('app-files-status')!;
    expect(status.textContent).toContain('1:1');
    expect(status.textContent).toContain('LF');
    expect(status.textContent).toContain('TypeScript');
    expect(status.textContent).not.toContain('Claude travaille');
    el.remove();
  });

  it('fil d’Ariane de la barre d’état : un segment révèle le dossier dans l’arbre et y met le focus', async () => {
    const { el, settle, rows, row, btn } = render({ files: async () => aProjectFiles({ files: ['src/app/main.ts', 'README.md'], collapsed: [] }) });
    await settle();
    // Ouvre src/app/main.ts depuis l'arbre, puis replie tout.
    row('src').click(); await settle();
    row('src/app').click(); await settle();
    row('src/app/main.ts').click(); await settle();
    btn('Tout replier').click(); await settle();
    expect(rows().map((r) => r.dataset['path'])).toEqual(['src', 'README.md']);

    const crumbs = [...el.querySelectorAll<HTMLButtonElement>('app-files-status .crumb')];
    expect(crumbs.map((c) => c.textContent)).toEqual(['src', 'app', 'main.ts']);
    expect(crumbs[2].getAttribute('aria-current')).toBe('location');
    expect(el.querySelectorAll('app-files-status .sep')).toHaveLength(2);
    crumbs[1].click();
    await settle();
    expect(rows().map((r) => r.dataset['path'])).toEqual(['src', 'src/app', 'src/app/main.ts', 'README.md']);
    expect(document.activeElement).toBe(row('src/app'));
    el.remove();
  });

  it('« Localiser le fichier ouvert » depuis une autre vue : revient à Projet et met le focus sur le fichier', async () => {
    const { el, settle, row, btn } = render({ files: async () => aProjectFiles({ files: ['src/app/main.ts', 'README.md'], collapsed: [] }) });
    await settle();
    expect(btn('Localiser le fichier ouvert').disabled).toBe(true);
    row('src').click(); await settle();
    row('src/app').click(); await settle();
    row('src/app/main.ts').click(); await settle();
    btn('Tout replier').click(); await settle();
    btn('Localiser le fichier ouvert').click();
    await settle();
    expect(document.activeElement).toBe(row('src/app/main.ts'));
    el.remove();
  });

  it('barre d’activité : vues, bouton actif sans effet, Masquer puis réouverture par l’icône', async () => {
    const { el, settle, btn } = render();
    await settle();
    const act = (v: string) => el.querySelector<HTMLButtonElement>(`app-files-activity [data-view=${v}]`)!;
    expect([act('project'), act('search'), act('claude')].map((b) => b.getAttribute('aria-label'))).toEqual(['Projet', 'Rechercher', 'Claude']);
    expect(act('project').getAttribute('aria-current')).toBe('true');

    act('claude').click();
    await settle();
    expect(el.querySelector('.tw-title')!.textContent).toBe('Claude');
    expect(el.querySelector('app-files-claude-here')!.textContent).toContain('Fichiers touchés');
    expect(act('claude').getAttribute('aria-current')).toBe('true');
    expect(act('project').getAttribute('aria-current')).toBeNull();

    btn('Masquer le panneau').click();
    await settle();
    expect(el.querySelector<HTMLElement>('.side')!.inert).toBe(true);
    expect(act('claude').getAttribute('aria-current')).toBeNull();
    expect(document.activeElement).toBe(act('claude')); // focus rendu à la barre
    act('claude').click();
    await settle();
    expect(el.querySelector<HTMLElement>('.side')!.inert).toBe(false);
    expect(el.querySelector('.tw-title')!.textContent).toBe('Claude');
    el.remove();
  });

  it('Claude travaille : cadenas dans la barre d’état, plus de bouton Éditer', async () => {
    const { fixture, el, settle, row } = render();
    await settle();
    fixture.componentRef.setInput('idle', false);
    await settle();
    row('README.md').click();
    await settle();
    expect(el.querySelector('app-files-status .busy')!.textContent).toContain('Claude travaille');
    expect(el.querySelector('app-files-editor-header .actions')!.textContent).not.toContain('Éditer');
    el.remove();
  });

  it('Ctrl+P : fenêtre « Aller au fichier » (combobox), filtre, Entrée ouvre le fichier gardé et ferme la fenêtre', async () => {
    const { el, settle, type, press, current } = render();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }));
    await settle();
    const dialog = el.querySelector<HTMLDialogElement>('app-files-finder dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    const input = dialog.querySelector<HTMLInputElement>('[role=combobox]')!;
    expect(document.activeElement).toBe(input);

    await type(input, 'readme');
    const options = () => [...dialog.querySelectorAll('[role=option]')].map((o) => o.textContent!.replace(/\s+/g, ' ').trim());
    expect(options()).toEqual(['README.md', 'Chercher « readme » dans le contenu']);
    expect(input.getAttribute('aria-activedescendant')).toBe('finder-opt-0');
    await press(input, 'Enter');
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(current()!.querySelector('.tn')!.textContent).toBe('README.md');
    expect(current()!.classList).not.toContain('preview');
    el.remove();
  });

  it('Ctrl+P puis « dans le contenu » : vue Rechercher pré-remplie, résultats ; clic qui ouvre à la ligne', async () => {
    const content = 'export const a = 1;\n\n  export const b = 2;\n';
    const { el, settle, type, press, current } = render({ readProjectFile: async (_id: string, path: string) => ({ path, content, hash: 'h' }) });
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }));
    await settle();
    const input = el.querySelector<HTMLInputElement>('app-files-finder [role=combobox]')!;
    await type(input, 'export');
    await press(input, 'ArrowUp'); // circulaire : la dernière ligne, « dans le contenu »
    await press(input, 'Enter');
    await settle();
    expect(el.querySelector('.tw-title')!.textContent).toBe('Rechercher');
    const field = el.querySelector<HTMLInputElement>('app-files-search input')!;
    expect(field.value).toBe('export');
    expect(document.activeElement).toBe(field);
    await new Promise((r) => setTimeout(r, 300)); // debounce
    await settle();
    expect(el.querySelector('app-files-search [role=status]')!.textContent).toContain('3 résultats dans 2 fichiers');
    const items = [...el.querySelectorAll<HTMLElement>('app-files-search [role=treeitem]')];
    expect(items.map((i) => i.getAttribute('aria-level'))).toEqual(['1', '2', '2', '1', '2']);
    items[2].click();
    await settle();
    await settle(); // lecture du fichier, puis curseur posé
    expect(current()!.querySelector('.tn')!.textContent).toBe('a.ts');
    expect(el.querySelector('app-files-status')!.textContent).toContain('3:3');
    el.remove();
  });

  it('Ctrl+Shift+F : vue Rechercher, focus dans le champ ; « Respecter la casse » dans l’en-tête ; Échap vide le champ', async () => {
    const { el, settle, type, press, btn } = render();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true }));
    await settle();
    const field = el.querySelector<HTMLInputElement>('app-files-search input')!;
    expect(document.activeElement).toBe(field);
    const aa = btn('Respecter la casse');
    aa.click();
    await settle();
    expect(aa.getAttribute('aria-pressed')).toBe('true');
    await type(field, 'zz');
    await press(field, 'Escape');
    expect(field.value).toBe('');
    el.remove();
  });
});
