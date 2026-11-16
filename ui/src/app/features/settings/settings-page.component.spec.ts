import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { AttentionService } from '../../core/attention.service';
import { ThemeService } from '../../core/theme.service';
import { SettingsPageComponent } from './settings-page.component';

describe('SettingsPageComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  /** Page créée, réglages du daemon déjà répondus (sinon whenStable attend la requête). */
  const create = () => {
    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/settings').flush({ locale: null, defaultLocale: 'en_US.UTF-8' });
    return fixture;
  };

  it('change et mémorise le thème', async () => {
    localStorage.clear();
    const fixture = create();
    await fixture.whenStable();
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('[value="light"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(theme.theme()).toBe('light');
    expect(localStorage.getItem('vigie-theme')).toBe('light');
  });

  it('règle les notifications par type, le son et la pause', async () => {
    localStorage.clear();
    const fixture = create();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('[aria-labelledby="setting-waiting"] [value="off"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-labelledby="setting-turn"] [value="inapp"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-labelledby="setting-usage"] [value="off"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-labelledby="setting-sound"] [value="off"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    const attention = TestBed.inject(AttentionService);
    expect(attention.systemWaiting()).toBe(false);
    expect(attention.turn()).toBe('inapp');
    expect(attention.usage()).toBe(false);
    expect(attention.sound()).toBe(false);
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Pause pendant 1 h'))!.click();
    await fixture.whenStable();
    expect(attention.pausedUntil()).not.toBeNull();
    expect(el.textContent).toContain('En pause jusqu');
  });

  it('enregistre la locale des terminaux auprès du daemon', async () => {
    const fixture = create();
    const http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('form.locale input') as HTMLInputElement;
    expect(input.placeholder).toBe('en_US.UTF-8');
    input.value = 'fr_FR.UTF-8';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (el.querySelector('form.locale button') as HTMLButtonElement).click();
    const req = http.expectOne({ method: 'POST', url: '/api/settings' });
    expect(req.request.body).toEqual({ locale: 'fr_FR.UTF-8' });
    req.flush({ locale: 'fr_FR.UTF-8', defaultLocale: 'en_US.UTF-8' });
    await fixture.whenStable();
    expect(input.value).toBe('fr_FR.UTF-8');
  });
});
