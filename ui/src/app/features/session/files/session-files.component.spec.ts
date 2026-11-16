import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { CLIENT_OS } from '../../../core/platform';
import { aProjectFiles, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionFilesComponent } from './session-files.component';

describe('SessionFilesComponent', () => {
  it('affiche l’arbre, déplie un dossier et ouvre un fichier dans un onglet', async () => {
    TestBed.configureTestingModule({ providers: [provideConfirmServiceMock(), provideVigieServiceMock({ files: async () => aProjectFiles({ truncated: true }) })] });
    const fixture = TestBed.createComponent(SessionFilesComponent);
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('idle', true);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();

    expect(el.textContent).toContain('liste est incomplète');
    const rows = () => [...el.querySelectorAll<HTMLElement>('[role=treeitem]')];
    expect(rows().map((r) => r.textContent!.trim())).toEqual(['node_modules, ignoré, contenu non listé', 'src', '.env', 'README.md']);
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]); // roving tabindex
    const src = rows()[1];
    expect(src.getAttribute('aria-expanded')).toBe('false');
    expect(rows()[0].getAttribute('aria-disabled')).toBe('true'); // ignoré : non dépliable
    src.click();
    await settle();
    expect(src.getAttribute('aria-expanded')).toBe('true');

    rows().find((r) => r.textContent!.trim() === 'a.ts')!.click();
    await settle();
    const current = () => el.querySelector('.tab-name[aria-current=page]')!.textContent!.trim();
    expect(current()).toBe('a.ts, aperçu'); // clic dans l'arbre : onglet d'aperçu
    el.querySelector('.tab')!.dispatchEvent(new MouseEvent('dblclick'));
    await settle();
    expect(current()).toBe('a.ts'); // double-clic : gardé
    expect(el.querySelector('.crumbs')!.textContent).toContain('a.ts');
    const ta = el.querySelector<HTMLTextAreaElement>('app-code-editor textarea')!;
    expect(ta.value).toContain('export const a = 1;');
    expect(ta.readOnly).toBe(true);
    expect(el.querySelector('app-files-status')!.textContent).toContain('TypeScript');
    expect(el.querySelector('[role=treeitem][aria-selected=true]')!.textContent!.trim()).toBe('a.ts');
  });

  it('Ctrl+P ouvre la palette, la saisie filtre, Entrée ouvre le fichier', async () => {
    TestBed.configureTestingModule({ providers: [provideConfirmServiceMock(), provideVigieServiceMock(), { provide: CLIENT_OS, useValue: 'linux' }] });
    const fixture = TestBed.createComponent(SessionFilesComponent);
    fixture.componentRef.setInput('sessionId', 's1');
    const el = fixture.nativeElement as HTMLElement;
    document.body.append(el); // focus : seulement dans le document
    // jsdom n'a ni showModal ni close.
    Object.assign(HTMLDialogElement.prototype, { showModal(this: HTMLDialogElement) { this.open = true; }, close(this: HTMLDialogElement) { this.open = false; } });
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }));
    await settle();
    const dialog = el.querySelector('dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('[role=combobox]')!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(input);
    input.value = 'readme';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect([...el.querySelectorAll('app-files-quick [role=option]')].map((o) => o.textContent!.trim())).toEqual(['README.md']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(dialog.open).toBe(false);
    expect(el.querySelector('app-files-tabs .tab-name[aria-current=page]')!.textContent!.trim()).toBe('README.md'); // pas un aperçu
    el.remove();
  });

  it('Ctrl+Shift+F : saisie, résultats surlignés, clic qui ouvre le fichier à la ligne', async () => {
    const content = 'export const a = 1;\n\n  export const b = 2;\n';
    TestBed.configureTestingModule({ providers: [provideConfirmServiceMock(), { provide: CLIENT_OS, useValue: 'linux' },
      provideVigieServiceMock({ readProjectFile: async (_id: string, path: string) => ({ path, content, hash: 'h' }) })] });
    const fixture = TestBed.createComponent(SessionFilesComponent);
    fixture.componentRef.setInput('sessionId', 's1');
    const el = fixture.nativeElement as HTMLElement;
    document.body.append(el);
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true }));
    await settle();
    const input = el.querySelector<HTMLInputElement>('app-files-search input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'export';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300)); // debounce
    await settle();
    expect(el.querySelector('app-files-search [role=status]')!.textContent).toContain('3 résultats dans 2 fichiers');
    const items = [...el.querySelectorAll<HTMLElement>('app-files-search [role=treeitem]')];
    expect(items.map((i) => i.getAttribute('aria-level'))).toEqual(['1', '2', '2', '1', '2']);
    expect(items[0].textContent).toContain('a.ts');
    expect(items[0].textContent).toContain('2 résultats');
    expect(items[2].querySelector('mark')!.textContent).toBe('export');

    items[2].click();
    await settle();
    await settle(); // lecture du fichier, puis curseur posé
    expect(el.querySelector('app-files-tabs .tab-name[aria-current=page]')!.textContent!.trim()).toBe('a.ts, aperçu');
    expect(el.querySelector('app-files-status')!.textContent).toContain('Ln 3, Col 3');
    expect(el.querySelector<HTMLTextAreaElement>('app-code-editor textarea')!.selectionStart).toBe(content.indexOf('export const b'));
    el.remove();
  });
});
