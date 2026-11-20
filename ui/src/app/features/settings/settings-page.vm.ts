import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { form, submit, validateStandardSchema } from '@angular/forms/signals';
import { TranslocoService } from '@jsverse/transloco';
import * as z from 'zod/mini';
import * as C from '@vigie/contract';
import { AttentionService } from '../../core/attention.service';
import { clock } from '../../core/format';
import { Lang, LanguageService, isLang } from '../../core/language.service';
import { Alerts } from '../../core/models';
import { CLIENT_OS } from '../../core/platform';
import { Theme, ThemeService } from '../../core/theme.service';
import { VigieService, daemonError } from '../../core/vigie.service';

/** Saisie française (« 20,5 ») → nombre ; vide → null (seuil désactivé). NaN est rejeté par le schéma du contrat. */
const toNumber = (s: string) => { const t = s.trim().replace(',', '.'); return t === '' ? null : Number(t); };

const toFraction = (s: string) => { const n = toNumber(s); return n == null ? n : n / 100; };

/** Saisie → corps `alerts` du contrat (% → fraction). */
export const toAlerts = (m: { dailyCost: string; windowPct: string }): Alerts => ({ dailyCost: toNumber(m.dailyCost), windowPct: toFraction(m.windowPct) });

/** Champ texte validé par le schéma du contrat après conversion : son message d'erreur est affiché tel quel. */
const viaContract = (schema: z.ZodMiniType, convert: (s: string) => unknown) =>
  z.string().check(z.superRefine((s, ctx) => {
    const r = schema.safeParse(convert(s));
    if (!r.success) ctx.issues.push({ code: 'custom', message: r.error.issues[0].message, input: s });
  }));

/** Seuils saisis en texte ($ et %), validés par les schémas du contrat. */
const AlertsForm = z.object({ dailyCost: viaContract(C.Alerts.shape.dailyCost, toNumber), windowPct: viaContract(C.Alerts.shape.windowPct, toFraction) });

const toText = (a: Alerts | undefined) => ({
  dailyCost: a?.dailyCost != null ? String(a.dailyCost) : '',
  windowPct: a?.windowPct != null ? String(Math.round(a.windowPct * 1000) / 10) : '',
});

@Injectable()
export class SettingsPageVm {
  readonly theme = inject(ThemeService);
  private readonly language = inject(LanguageService);
  /** Valeur du groupe de bascule : la langue active, ou celle cliquée pendant son chargement ; revient sur l'active si
   *  le catalogue manque ou si un autre clic l'a remplacée. */
  readonly langChoice = linkedSignal<Lang>(() => this.language.lang());
  readonly attention = inject(AttentionService);
  /** OS du navigateur : le chemin des réglages de notifications en dépend. */
  readonly os = inject(CLIENT_OS);

  private readonly vigie = inject(VigieService);
  private readonly transloco = inject(TranslocoService);
  private readonly resource = this.vigie.settingsResource();
  /** Réglages du daemon ; undefined pendant le chargement ou s'il ne répond pas (thème et notifications restent réglables). */
  readonly settings = computed(() => (this.resource.hasValue() ? this.resource.value() : undefined));

  /** Saisie, réalignée sur le daemon à chaque chargement des réglages. */
  readonly locale = linkedSignal(() => this.settings()?.locale ?? '');
  readonly localeError = signal<string | null>(null);

  /** Seuils du daemon comparés par valeur : enregistrer la locale (nouveaux réglages, mêmes seuils) ne remet pas la saisie à zéro. */
  private readonly alerts = computed(() => this.settings()?.alerts, { equal: (a, b) => a?.dailyCost === b?.dailyCost && a?.windowPct === b?.windowPct });
  readonly alertsModel = linkedSignal(() => toText(this.alerts()));
  readonly alertsForm = form(this.alertsModel, (p) => {
    validateStandardSchema(p, AlertsForm);
  });
  readonly alertsError = signal<string | null>(null);
  readonly alertsSaved = signal(false);

  async saveLocale(value: string): Promise<void> {
    try {
      await this.vigie.saveSettings({ locale: value.trim() || null });
      this.localeError.set(null);
    } catch (e) {
      this.localeError.set(daemonError(e, this.transloco.translate('settings.locale.notSaved')));
    }
  }

  async saveAlerts(): Promise<void> {
    this.alertsError.set(null);
    this.alertsSaved.set(false);
    await submit(this.alertsForm, async () => {
      try {
        await this.vigie.saveSettings({ alerts: toAlerts(this.alertsModel()) });
        this.alertsSaved.set(true);
      } catch (e) {
        this.alertsError.set(daemonError(e, this.transloco.translate('settings.alerts.notSaved')));
      }
      return undefined;
    });
  }

  /** Format de l'heure de fin de pause. */
  readonly clock = clock;

  setTurn(value: unknown): void {
    if (value === 'inapp' || value === 'system' || value === 'off') void this.attention.setTurn(value);
  }

  setTheme(value: unknown): void {
    if (value === 'light' || value === 'dark') this.theme.set(value as Theme);
  }

  async setLang(value: unknown): Promise<void> {
    if (!isLang(value)) return;
    this.langChoice.set(value);
    await this.language.set(value);
    this.langChoice.set(this.language.lang());
  }
}
