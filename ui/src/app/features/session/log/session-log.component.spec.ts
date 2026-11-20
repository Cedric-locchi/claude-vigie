import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionLog } from '../../../core/models';
import { CLIENT_OS } from '../../../core/platform';
import { SessionLogComponent } from './session-log.component';

describe('SessionLogComponent', () => {
  it('liste le journal et met la recherche au focus avec ⌘F', async () => {
    const sessionLog = vi.fn(async (): Promise<SessionLog> => ({ entries: [
      { id: 'S:1', ts: 1000, kind: 'error', title: 'Bash', text: 'FAIL x.spec.ts', truncated: false, agent: 'Agent principal', sub: false },
    ] }));
    TestBed.configureTestingModule({ providers: [{ provide: CLIENT_OS, useValue: 'mac' }, provideVigieServiceMock({ sessionLog })] });
    const fixture = TestBed.createComponent(SessionLogComponent);
    fixture.componentRef.setInput('sessionId', 'S');
    fixture.componentRef.setInput('lastTs', 1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.entry[data-kind=error]')!.textContent).toContain('FAIL x.spec.ts');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true }));
    expect(document.activeElement).toBe(el.querySelector('input[type=search]'));
  });
});
