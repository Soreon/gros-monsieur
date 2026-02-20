/**
 * i18n — Gros Monsieur
 * Système de traduction léger, sans dépendance.
 *
 * Usage :
 *   import { t, setLocale, getLocale } from './i18n.js';
 *   t('nav.profile')            → "Profil"
 *   t('session.sets', { n: 3 }) → "3 séries"
 */

const locales = {};
let currentLocale = 'fr';

/**
 * Initialise le système i18n.
 * Charge la locale demandée (et 'fr' en fallback si différente).
 * @param {string} locale - Code langue ('fr', 'en', …)
 */
export async function initI18n(locale = 'fr') {
  if (!locales['fr']) {
    const mod = await import('./data/locales/fr.js');
    locales['fr'] = mod.default;
  }

  if (locale !== 'fr' && !locales[locale]) {
    try {
      const mod = await import(`./data/locales/${locale}.js`);
      locales[locale] = mod.default;
    } catch {
      console.warn(`[i18n] Locale "${locale}" introuvable, utilisation de "fr".`);
      locale = 'fr';
    }
  }

  currentLocale = locale;
  document.documentElement.setAttribute('lang', locale);
}

/**
 * Traduit une clé.
 * @param {string} key         - Clé de traduction (ex: 'nav.profile')
 * @param {Object} [vars={}]   - Variables à interpoler (ex: { n: 3 })
 * @returns {string}
 */
export function t(key, vars = {}) {
  const dict = locales[currentLocale] ?? locales['fr'] ?? {};
  let str = dict[key] ?? locales['fr']?.[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Retourne la locale active. */
export function getLocale() {
  return currentLocale;
}

/**
 * Change la locale à chaud et met à jour le DOM.
 * @param {string} locale
 */
export async function setLocale(locale) {
  await initI18n(locale);
  // Déclenche un événement pour que les pages puissent se re-render
  window.dispatchEvent(new CustomEvent('locale-changed', { detail: { locale } }));
}

/** Liste des locales disponibles. */
export const AVAILABLE_LOCALES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
];
