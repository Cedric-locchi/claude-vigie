import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  it('pose la question et rend la réponse de la boîte de dialogue', async () => {
    const confirm = TestBed.inject(ConfirmService);
    const answer = confirm.deleteSession({ title: 'Portage macOS', terminalId: 't1' });
    expect(confirm.pending()!.message).toContain('Claude arrêté');
    expect(confirm.pending()!.message).toContain('claude --resume');
    expect(confirm.pending()!.danger).toBe(true);
    confirm.answer(true);
    expect(await answer).toBe(true);
    expect(confirm.pending()).toBeNull();
  });

  it('une nouvelle question annule la précédente', async () => {
    const confirm = TestBed.inject(ConfirmService);
    const first = confirm.ask({ title: 'A', message: '', action: 'OK' });
    const second = confirm.ask({ title: 'B', message: '', action: 'OK' });
    expect(await first).toBe(false);
    confirm.answer(true);
    expect(await second).toBe(true);
  });

  it('reprise : pas de question pour une session terminée', async () => {
    const confirm = TestBed.inject(ConfirmService);
    expect(await confirm.resumeSession({ title: 'X', state: 'done' })).toBe(true);
    expect(confirm.pending()).toBeNull();
  });
});
