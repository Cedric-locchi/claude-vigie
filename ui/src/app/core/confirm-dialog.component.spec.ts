import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmService } from './confirm.service';

describe('ConfirmDialogComponent', () => {
  it('affiche la question dans une alert-dialog et transmet la réponse', async () => {
    const fixture = TestBed.createComponent(ConfirmDialogComponent);
    const confirm = TestBed.inject(ConfirmService);
    const answer = confirm.ask({ title: 'Supprimer « X » ?', message: 'La session disparaît.', action: 'Supprimer', danger: true });
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = document.querySelector('[role=alertdialog]')!;
    expect(dialog.textContent).toContain('Supprimer « X » ?');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Supprimer')!.click();
    expect(await answer).toBe(true);
  });
});
