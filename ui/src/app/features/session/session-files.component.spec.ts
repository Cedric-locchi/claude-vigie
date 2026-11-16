import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { provideConfirmServiceMock } from '../../core/confirm.service.mock';
import { aProjectFiles, provideVigieServiceMock } from '../../core/vigie.service.mock';
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
    expect(el.querySelector('.tab-name[aria-current=page]')!.textContent!.trim()).toBe('a.ts');
    expect(el.querySelector('.crumbs')!.textContent).toContain('a.ts');
    const ta = el.querySelector<HTMLTextAreaElement>('app-code-editor textarea')!;
    expect(ta.value).toContain('export const a = 1;');
    expect(ta.readOnly).toBe(true);
    expect(el.querySelector('.status')!.textContent).toContain('TypeScript');
    expect(el.querySelector('[role=treeitem][aria-selected=true]')!.textContent!.trim()).toBe('a.ts');
  });
});
