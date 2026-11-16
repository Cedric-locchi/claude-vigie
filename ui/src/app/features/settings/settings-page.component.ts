import { Component, computed, inject } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { SettingsPageVm } from './settings-page.vm';

/** Réglages de l'app : une section par sujet, ajoutées au fur et à mesure. */
@Component({
  selector: 'app-settings-page',
  imports: [FormField, HlmButton, HlmCardImports, HlmInput, HlmToggleGroupImports],
  providers: [SettingsPageVm],
  template: `
    <div class="page">
      <header>
        <h1>Réglages</h1>
        <p class="muted">Mémorisés sur cette machine</p>
      </header>

      <section hlmCard class="setting" aria-labelledby="setting-theme">
        <div class="text">
          <h2 id="setting-theme">Thème</h2>
          <p class="small muted">Apparence de Vigie, en clair ou en sombre.</p>
        </div>
        <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-theme" [value]="vm.theme.theme()" (valueChange)="vm.setTheme($event)">
          <button hlmToggleGroupItem value="light" class="gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            Clair
          </button>
          <button hlmToggleGroupItem value="dark" class="gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            Sombre
          </button>
        </div>
      </section>

      <section hlmCard class="setting notify" aria-labelledby="setting-notify">
        <div class="text">
          <h2 id="setting-notify">Notifications</h2>
          <p class="small muted">La cloche montre toujours ce qui t'attend. Quand Vigie a le focus, un toast te prévient ; sinon, la notification système.</p>
          @if (vm.attention.wantsSystem() && vm.attention.permission() === 'denied') {
            <p class="small blocked" role="alert">
              @switch (vm.os) {
                @case ('mac') { Notifications système bloquées : autorise Vigie (« Electron » en dev) dans Réglages Système › Notifications, ou le site dans ton navigateur. }
                @case ('windows') { Notifications système bloquées : autorise ton navigateur dans Paramètres › Système › Notifications, et le site dans ses réglages. }
                @default { Notifications système bloquées : autorise Vigie (« Electron » en dev) dans les réglages de notifications de ton bureau, ou le site dans ton navigateur. }
              }
            </p>
          }
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-waiting">Autorisations et questions</h3><p class="small muted">Toujours dans la cloche et en toast. Notification système quand Vigie n'a pas le focus :</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-waiting" [value]="vm.attention.systemWaiting() ? 'on' : 'off'" (valueChange)="vm.attention.setSystemWaiting($event === 'on')">
            <button hlmToggleGroupItem value="on">Activée</button>
            <button hlmToggleGroupItem value="off">Coupée</button>
          </div>
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-turn">Fins de tour</h3><p class="small muted">Claude a fini et te rend la main.</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-turn" [value]="vm.attention.turn()" (valueChange)="vm.setTurn($event)">
            <button hlmToggleGroupItem value="inapp">Dans Vigie</button>
            <button hlmToggleGroupItem value="system">Système aussi</button>
            <button hlmToggleGroupItem value="off">Rien</button>
          </div>
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-usage">Alertes de consommation</h3><p class="small muted">Toast ou notification au franchissement d'un seuil (voir plus bas). La cloche les garde dans tous les cas.</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-usage" [value]="vm.attention.usage() ? 'on' : 'off'" (valueChange)="vm.attention.setUsage($event === 'on')">
            <button hlmToggleGroupItem value="on">Activées</button>
            <button hlmToggleGroupItem value="off">Coupées</button>
          </div>
        </div>
        <div class="opt">
          <div class="text"><h3 id="setting-sound">Son</h3><p class="small muted">Petit carillon : deux notes pour une demande, une pour une fin de tour.</p></div>
          <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-labelledby="setting-sound" [value]="vm.attention.sound() ? 'on' : 'off'" (valueChange)="vm.attention.setSound($event === 'on')">
            <button hlmToggleGroupItem value="on">Activé</button>
            <button hlmToggleGroupItem value="off">Coupé</button>
          </div>
        </div>
        <div class="opt">
          <div class="text">
            <h3 id="setting-pause">Ne pas déranger</h3>
            <p class="small muted" role="status">
              @if (vm.attention.pausedUntil(); as until) { En pause jusqu'à <span class="mono">{{ vm.clock(until) }}</span> : ni son ni notification système. }
              @else { Coupe le son et les notifications système pendant 1 h ; la cloche et les toasts continuent. }
            </p>
          </div>
          @if (vm.attention.pausedUntil()) {
            <button hlmBtn variant="outline" size="sm" aria-describedby="setting-pause" (click)="vm.attention.resume()">Reprendre</button>
          } @else {
            <button hlmBtn variant="outline" size="sm" aria-describedby="setting-pause" (click)="vm.attention.pause()">Pause pendant 1 h</button>
          }
        </div>
      </section>

      <section hlmCard class="setting" aria-labelledby="setting-locale">
        <div class="text">
          <h2 id="setting-locale">Locale des terminaux</h2>
          <p class="small muted">
            Encodage et langue du shell et de claude (accents, symboles). Vide : automatique
            @if (vm.settings.value(); as s) { (<span class="mono">{{ s.defaultLocale }}</span>) }.
            Vaut pour les terminaux ouverts ensuite.
          </p>
          @if (vm.localeError(); as err) { <p class="small blocked" role="alert">{{ err }}</p> }
        </div>
        <form class="locale" (submit)="$event.preventDefault(); vm.saveLocale(vm.locale())">
          <input hlmInput class="mono" aria-labelledby="setting-locale" [value]="vm.locale()" (input)="vm.locale.set($any($event.target).value)"
            [placeholder]="vm.settings.value()?.defaultLocale ?? 'fr_FR.UTF-8'" autocomplete="off" spellcheck="false" [attr.aria-invalid]="!!vm.localeError()" />
          <button hlmBtn size="sm" type="submit" [disabled]="vm.locale().trim() === (vm.settings.value()?.locale ?? '')">Enregistrer</button>
        </form>
      </section>

      <section hlmCard class="setting" aria-labelledby="setting-alerts">
        <div class="text">
          <h2 id="setting-alerts">Alertes de consommation</h2>
          <p class="small muted">Une alerte quand le coût estimé du jour ou la fenêtre de 5 h dépasse ton seuil : une fois par jour pour le coût, une fois par fenêtre. Vide : pas d'alerte.</p>
          @if (vm.alertsError(); as err) { <p class="small blocked" role="alert">{{ err }}</p> }
          @if (vm.alertsSaved()) { <p class="small muted" role="status">Seuils enregistrés.</p> }
        </div>
        <form class="alerts" novalidate (submit)="$event.preventDefault(); vm.saveAlerts()">
          <label class="field">
            <span class="small muted">Coût du jour</span>
            <span class="unit"><input hlmInput class="mono" inputmode="decimal" placeholder="ex. 20" autocomplete="off" [formField]="vm.alertsForm.dailyCost" [attr.aria-invalid]="costInvalid()" aria-describedby="alert-cost-err" /><span class="small muted" aria-hidden="true">$</span></span>
            <span id="alert-cost-err" class="small blocked">@if (costInvalid()) { {{ vm.alertsForm.dailyCost().errors()[0]?.message }} }</span>
          </label>
          <label class="field">
            <span class="small muted">Fenêtre de 5 h</span>
            <span class="unit"><input hlmInput class="mono" inputmode="decimal" placeholder="ex. 80" autocomplete="off" [formField]="vm.alertsForm.windowPct" [attr.aria-invalid]="pctInvalid()" aria-describedby="alert-pct-err" /><span class="small muted" aria-hidden="true">%</span></span>
            <span id="alert-pct-err" class="small blocked">@if (pctInvalid()) { {{ vm.alertsForm.windowPct().errors()[0]?.message }} }</span>
          </label>
          <button hlmBtn size="sm" type="submit" [disabled]="vm.alertsForm().submitting()">Enregistrer</button>
        </form>
      </section>
    </div>
  `,
  styles: `
    .page { max-width: 760px; gap: 12px; }
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
