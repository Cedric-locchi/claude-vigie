import { Component, computed, inject } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { TranslocoDirective } from '@jsverse/transloco';
import { SettingsPageVm } from './settings-page.vm';
import { PageComponent } from '../../shell/page/page.component';

/** Réglages de l'app : une section par sujet, ajoutées au fur et à mesure. */
@Component({
  selector: 'app-settings-page',
  imports: [TranslocoDirective, PageComponent, FormField, HlmButton, HlmCardImports, HlmInput, HlmToggleGroupImports],
  providers: [SettingsPageVm],
  template: `
    <app-page *transloco="let t; prefix: 'settings'">
      <header pageHeader>
        <h1>{{ t('title') }}</h1>
        <p class="muted">{{ t('subtitle') }}</p>
      </header>

      <section hlmCard class="setting" aria-labelledby="setting-lang">
        <div class="text">
          <h2 id="setting-lang">{{ t('language.title') }}</h2>
          <p class="small muted">{{ t('language.hint') }}</p>
        </div>
        <!-- Endonymes, hors catalogue : chaque langue se nomme elle-même. -->
        <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-lang" [value]="vm.langChoice()" (valueChange)="vm.setLang($event)">
          <button hlmToggleGroupItem value="fr" lang="fr">Français</button>
          <button hlmToggleGroupItem value="en" lang="en">English</button>
        </div>
      </section>

      <section hlmCard class="setting" aria-labelledby="setting-theme">
        <div class="text">
          <h2 id="setting-theme">{{ t('theme.title') }}</h2>
          <p class="small muted">{{ t('theme.hint') }}</p>
        </div>
        <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-theme" [value]="vm.theme.theme()" (valueChange)="vm.setTheme($event)">
          <button hlmToggleGroupItem value="light" class="gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            {{ t('theme.light') }}
          </button>
          <button hlmToggleGroupItem value="dark" class="gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            {{ t('theme.dark') }}
          </button>
        </div>
      </section>

      <section hlmCard class="setting notify" aria-labelledby="setting-notify">
        <div class="text">
          <h2 id="setting-notify">{{ t('notify.title') }}</h2>
          <p class="small muted">{{ t('notify.hint') }}</p>
          @if (vm.attention.wantsSystem() && vm.attention.permission() === 'denied') {
            <p class="small blocked" role="alert">
              @switch (vm.os) {
                @case ('mac') { {{ t('notify.blockedMac') }} }
                @case ('windows') { {{ t('notify.blockedWindows') }} }
                @default { {{ t('notify.blockedOther') }} }
              }
            </p>
          }
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-waiting">{{ t('notify.waiting.title') }}</h3><p class="small muted">{{ t('notify.waiting.hint') }}</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-waiting" [value]="vm.attention.systemWaiting() ? 'on' : 'off'" (valueChange)="vm.attention.setSystemWaiting($event === 'on')">
            <button hlmToggleGroupItem value="on">{{ t('notify.waiting.on') }}</button>
            <button hlmToggleGroupItem value="off">{{ t('notify.waiting.off') }}</button>
          </div>
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-turn">{{ t('notify.turn.title') }}</h3><p class="small muted">{{ t('notify.turn.hint') }}</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-turn" [value]="vm.attention.turn()" (valueChange)="vm.setTurn($event)">
            <button hlmToggleGroupItem value="inapp">{{ t('notify.turn.inapp') }}</button>
            <button hlmToggleGroupItem value="system">{{ t('notify.turn.system') }}</button>
            <button hlmToggleGroupItem value="off">{{ t('notify.turn.off') }}</button>
          </div>
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-usage">{{ t('notify.usage.title') }}</h3><p class="small muted">{{ t('notify.usage.hint') }}</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-usage" [value]="vm.attention.usage() ? 'on' : 'off'" (valueChange)="vm.attention.setUsage($event === 'on')">
            <button hlmToggleGroupItem value="on">{{ t('notify.usage.on') }}</button>
            <button hlmToggleGroupItem value="off">{{ t('notify.usage.off') }}</button>
          </div>
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-sound">{{ t('notify.sound.title') }}</h3><p class="small muted">{{ t('notify.sound.hint') }}</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-sound" [value]="vm.attention.sound() ? 'on' : 'off'" (valueChange)="vm.attention.setSound($event === 'on')">
            <button hlmToggleGroupItem value="on">{{ t('notify.sound.on') }}</button>
            <button hlmToggleGroupItem value="off">{{ t('notify.sound.off') }}</button>
          </div>
        </div>
        <div class="opt">
          <div class="text">
            <h3 id="setting-pause">{{ t('notify.pause.title') }}</h3>
            <p class="small muted" role="status">
              @if (vm.attention.pausedUntil(); as until) { {{ t('notify.pause.untilBefore') }}<span class="mono">{{ vm.clock(until) }}</span>{{ t('notify.pause.untilAfter') }} }
              @else { {{ t('notify.pause.idle') }} }
            </p>
          </div>
          @if (vm.attention.pausedUntil()) {
            <button hlmBtn variant="outline" size="sm" aria-describedby="setting-pause" (click)="vm.attention.resume()">{{ t('notify.pause.resume') }}</button>
          } @else {
            <button hlmBtn variant="outline" size="sm" aria-describedby="setting-pause" (click)="vm.attention.pause()">{{ t('notify.pause.start') }}</button>
          }
        </div>
      </section>

      <section hlmCard class="setting" aria-labelledby="setting-locale">
        <div class="text">
          <h2 id="setting-locale">{{ t('locale.title') }}</h2>
          <p class="small muted">{{ t('locale.hintBefore') }}@if (vm.settings(); as s) { (<span class="mono">{{ s.defaultLocale }}</span>)}{{ t('locale.hintAfter') }}</p>
          @if (vm.localeError(); as err) { <p class="small blocked" role="alert">{{ err }}</p> }
        </div>
        <form class="locale" (submit)="$event.preventDefault(); vm.saveLocale(vm.locale())">
          <input hlmInput class="mono" aria-labelledby="setting-locale" [value]="vm.locale()" (input)="vm.locale.set($any($event.target).value)"
            [placeholder]="vm.settings()?.defaultLocale ?? 'fr_FR.UTF-8'" autocomplete="off" spellcheck="false" [attr.aria-invalid]="!!vm.localeError()" />
          <button hlmBtn size="sm" type="submit" [disabled]="vm.locale().trim() === (vm.settings()?.locale ?? '')">{{ t('locale.save') }}</button>
        </form>
      </section>

      <section hlmCard class="setting" aria-labelledby="setting-alerts">
        <div class="text">
          <h2 id="setting-alerts">{{ t('alerts.title') }}</h2>
          <p class="small muted">{{ t('alerts.hint') }}</p>
          @if (vm.alertsError(); as err) { <p class="small blocked" role="alert">{{ err }}</p> }
          @if (vm.alertsSaved()) { <p class="small muted" role="status">{{ t('alerts.saved') }}</p> }
        </div>
        <form class="alerts" novalidate (submit)="$event.preventDefault(); vm.saveAlerts()">
          <label class="field">
            <span class="small muted">{{ t('alerts.dailyCost') }}</span>
            <span class="unit"><input hlmInput class="mono" inputmode="decimal" [placeholder]="t('alerts.example', { value: 20 })" autocomplete="off" [formField]="vm.alertsForm.dailyCost" [attr.aria-invalid]="costInvalid()" aria-describedby="alert-cost-err" /><span class="small muted" aria-hidden="true">$</span></span>
            <span id="alert-cost-err" class="small blocked">@if (costInvalid()) { {{ vm.alertsForm.dailyCost().errors()[0]?.message }} }</span>
          </label>
          <label class="field">
            <span class="small muted">{{ t('alerts.window') }}</span>
            <span class="unit"><input hlmInput class="mono" inputmode="decimal" [placeholder]="t('alerts.example', { value: 80 })" autocomplete="off" [formField]="vm.alertsForm.windowPct" [attr.aria-invalid]="pctInvalid()" aria-describedby="alert-pct-err" /><span class="small muted" aria-hidden="true">%</span></span>
            <span id="alert-pct-err" class="small blocked">@if (pctInvalid()) { {{ vm.alertsForm.windowPct().errors()[0]?.message }} }</span>
          </label>
          <button hlmBtn size="sm" type="submit" [disabled]="vm.alertsForm().submitting()">{{ t('alerts.save') }}</button>
        </form>
      </section>
    </app-page>
  `,
  styles: `
    app-page { --page-max: 760px; --page-gap: 12px; }
    header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    h1 { font-size: 24px; font-weight: 600; }
    .setting { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding: 16px 20px; }
    .text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 320px; min-width: 0; }
    .blocked { margin-top: 4px; color: var(--err); }
    .locale { display: flex; gap: 8px; align-items: center; }
    .locale input { width: 180px; }
    .alerts { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field .blocked { margin: 0; min-height: 16px; }
    .unit { display: flex; align-items: center; gap: 6px; }
    .unit input { width: 110px; }
    h2, h3 { margin: 0; font-size: 14px; font-weight: 600; }
    h3 { font-size: 13px; font-weight: 500; }
    .notify { align-items: stretch; }
    .notify > .text { flex-basis: 100%; }
    .opt { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px; padding-top: 12px; border-top: 1px solid var(--line); }
  `,
})
export class SettingsPageComponent {
  protected readonly vm = inject(SettingsPageVm);
  protected readonly costInvalid = computed(() => this.vm.alertsForm.dailyCost().touched() && this.vm.alertsForm.dailyCost().invalid());
  protected readonly pctInvalid = computed(() => this.vm.alertsForm.windowPct().touched() && this.vm.alertsForm.windowPct().invalid());
}
