import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionLog } from '../../../core/models';
import { SessionLogComponent } from './session-log.component';

describe('SessionLogComponent', () => {
  it('liste le journal ; ⌘F ne lui appartient plus (palette de recherche), la recherche imposée remplit son champ', async () => {
    const sessionLog = vi.fn(async (): Promise<SessionLog> => ({ entries: [
      { id: 'S:1', ts: 1000, kind: 'error', title: 'Bash', text: 'FAIL x.spec.ts', truncated: false, agent: 'Agent principal', sub: false },
    ] }));
    TestBed.configureTestingModule({ providers: [provideVigieServiceMock({ sessionLog })] });
    const fixture = TestBed.createComponent(SessionLogComponent);
    fixture.componentRef.setInput('sessionId', 'S');
    fixture.componentRef.setInput('lastTs', 1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.entry[data-kind=error]')!.textContent).toContain('FAIL x.spec.ts');
    const field = el.querySelector<HTMLInputElement>('input[type=search]')!;
    const ev = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(field);
    fixture.componentRef.setInput('query', { q: 'FAIL' });
    fixture.detectChanges();
    expect(field.value).toBe('FAIL');
    // Le <pre> garde les blancs du gabarit : le texte surligné doit rester celui de la ligne.
    expect(el.querySelector('pre.text')!.textContent).toBe('FAIL x.spec.ts');
    expect(el.querySelector('pre.text mark')!.textContent).toBe('FAIL');
  });
});
