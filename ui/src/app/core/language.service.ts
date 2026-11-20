import { DOCUMENT, Injectable, PendingTasks, Service, computed, inject, isDevMode } from '@angular/core';
import { Translation, TranslocoConfig, TranslocoLoader, TranslocoService, provideTransloco } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { reloadIfStale } from '../stale-build';
import { readPref, writePref } from './prefs';

// ponytail: seule la page Réglages passe par les catalogues (src/i18n/). Restent en français : les autres pages et la coque
// (lien « Réglages » de la barre latérale compris), les titres de route, OFFLINE / OUTDATED / les replis de daemonError, les
// messages du daemon et du contrat (validations Zod comprises), les dialogues d'Electron, les plugins et le SDK (TaskLauncher),
// les formats de core/format.ts. Pluriels : Intl.PluralRules + clés `one` / `other` le jour où il en faut, pas transloco-messageformat.

export const LANGS = ['fr', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

const KEY = 'vigie-lang';

/** Choix mémorisé, sinon la langue du système : fr* → français, sinon anglais. */
export const initialLang = (saved: string | null, system: string | undefined): Lang =>
  isLang(saved) ? saved : system?.toLowerCase().startsWith('fr') ? 'fr' : 'en';

export const I18N_CONFIG: Partial<TranslocoConfig> = { availableLangs: [...LANGS], defaultLang: 'fr', reRenderOnLangChange: true, prodMode: !isDevMode() };

// Un chunk haché par langue, hors chargement initial ; pas de HttpClient (HTTP seulement dans VigieService).
const CATALOGS: Record<Lang, () => Promise<{ default: Translation }>> = {
  fr: () => import('../../i18n/fr.json'),
  en: () => import('../../i18n/en.json'),
};

@Injectable()
class CatalogLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    if (!isLang(lang)) return Promise.reject(new Error(`Langue inconnue : ${lang}`));
    // UI mise à jour pendant que l'app est ouverte : l'ancien chunk n'existe plus, on recharge (comme plot-chart).
    return CATALOGS[lang]().then((m) => m.default, (e) => { reloadIfStale(e, location.pathname + location.search); throw e; });
  }
}

export const provideI18n = () => provideTransloco({ config: I18N_CONFIG, loader: CatalogLoader });

/** Langue de l'interface : choix mémorisé dans ce navigateur, sinon celle du système. */
@Service()
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly pending = inject(PendingTasks);

  readonly lang = computed<Lang>(() => { const l = this.transloco.activeLang(); return isLang(l) ? l : 'fr'; });

  /** Numéro de la dernière demande de `set` : une réponse plus ancienne, arrivée après elle, est ignorée. */
  private seq = 0;

  /**
   * Au démarrage (provideAppInitializer) : catalogue chargé avant le premier rendu. S'il manque, le français (sans catalogue
   * chargé, `*transloco` ne rend rien) ; si lui aussi manque, on démarre quand même.
   */
  init(): Promise<void> {
    return this.apply(initialLang(readPref(KEY), this.document.defaultView?.navigator.language))
      .catch(() => this.apply('fr'))
      .catch(() => undefined);
  }

  /**
   * Bascule une fois le catalogue chargé, puis mémorise le choix ; seule la dernière demande s'applique. Un échec laisse la
   * langue active et le choix mémorisé tels quels. Tâche en cours pendant le chargement : whenStable l'attend.
   * ponytail: Transloco garde en cache une langue en échec, un nouveau clic ne la relance pas ; un chunk disparu recharge
   * déjà la page (reloadIfStale). Vider ce cache à l'échec le jour où un autre cas se présente.
   */
  async set(lang: Lang): Promise<void> {
    const req = ++this.seq;
    const done = this.pending.add();
    try {
      await firstValueFrom(this.transloco.load(lang));
      if (req !== this.seq) return;
      this.activate(lang);
      writePref(KEY, lang);
    } catch {
      // Catalogue introuvable : rien ne change (Transloco signale l'échec en dev).
    } finally {
      done();
    }
  }

  private async apply(lang: Lang): Promise<void> {
    await firstValueFrom(this.transloco.load(lang));
    this.activate(lang);
  }

  private activate(lang: Lang): void {
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;
  }
}
