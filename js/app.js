/**
 * app.js — Point d'entrée principal
 * Gros Monsieur PWA
 *
 * Ordre d'initialisation :
 *  1. Thème (localStorage → évite le FOUC)
 *  2. i18n
 *  3. Bottom nav
 *  4. Routeur
 *  5. Service Worker
 */

import { initI18n } from './i18n.js';
import { initRouter } from './router.js';
import { BottomNav } from './components/bottom-nav.js';
import { initDB, dbGetProfile } from './db.js';
import SessionOverlay from './pages/session.js';

// Préférence de couleur d'accent — déclarée avant l'IIFE d'init ci-dessous
// (setTheme/applyAccent y sont appelés avant le reste du module).
let _accentPref = 'default';

// ── 1. Thème ─────────────────────────────────────────────────
// Appliqué immédiatement (avant le premier paint) depuis localStorage
// pour éviter le flash de thème incorrect.
(function applyInitialTheme() {
  const theme = localStorage.getItem('gm-theme') || 'dark';
  setTheme(theme);
  applyAccent(localStorage.getItem('gm-accent') || 'default');
})();

/**
 * Applique un thème sur <html data-theme>.
 * @param {'dark'|'light'|'auto'} theme
 */
export function setTheme(theme) {
  const html = document.documentElement;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', theme);
  }
  localStorage.setItem('gm-theme', theme);
  updateThemeColorMeta(theme);
  // Les variantes d'accent (hover/dim/on-accent) dépendent du thème effectif
  applyAccent(_accentPref);
}

// ── Couleur d'accent ──────────────────────────────────────────
// Préférence : 'default' (cyan du CSS) | 'system' (mot-clé CSS AccentColor)
// | '#rrggbb' (préréglage). Les variantes --accent-hover / --accent-dim /
// --on-accent sont dérivées de la couleur de base pour le thème effectif.

/** true si le navigateur expose la couleur d'accent de l'OS. */
export function supportsSystemAccent() {
  return typeof CSS !== 'undefined' && CSS.supports('color', 'AccentColor');
}

/** Résout le mot-clé AccentColor en "rgb(r, g, b)" via un élément sonde. */
function resolveSystemAccent() {
  if (!supportsSystemAccent()) return null;
  const probe = document.createElement('span');
  probe.style.color = 'AccentColor';
  probe.style.display = 'none';
  document.body ? document.body.appendChild(probe) : document.documentElement.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslCss({ h, s, l }) {
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/** Luminance relative WCAG (0 = noir, 1 = blanc). */
function relLuminance({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Applique la préférence de couleur d'accent.
 * 'default' retire les surcharges (retour aux valeurs du CSS) ; sinon la
 * couleur de base est résolue puis déclinée pour le thème effectif.
 * @param {'default'|'system'|string} pref
 */
export function applyAccent(pref) {
  _accentPref = pref || 'default';
  localStorage.setItem('gm-accent', _accentPref);
  const root = document.documentElement.style;

  let rgb = null;
  if (_accentPref === 'system') rgb = resolveSystemAccent();
  else if (_accentPref !== 'default') rgb = hexToRgb(_accentPref);

  if (!rgb) {
    // 'default', préréglage invalide ou AccentColor indisponible → CSS de base
    ['--accent', '--accent-hover', '--accent-dim', '--on-accent'].forEach(v => root.removeProperty(v));
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const hsl = rgbToHsl(rgb);

  root.setProperty('--accent', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
  root.setProperty('--accent-hover', hslCss({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + (isDark ? 0.10 : -0.10))) }));
  root.setProperty('--accent-dim', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.15 : 0.12})`);
  // Texte posé sur l'accent : blanc sur accent sombre, version très foncée
  // du même accent sinon (même logique que le --on-accent du CSS).
  root.setProperty('--on-accent', relLuminance(rgb) > 0.4
    ? hslCss({ ...hsl, l: 0.12 })
    : '#ffffff');
}

/** Préférence d'accent active ('default' | 'system' | '#rrggbb'). */
export function getAccentPref() {
  return _accentPref;
}

// La couleur d'accent de l'OS peut changer pendant que l'app tourne :
// re-résolution au retour de focus quand la préférence est 'system'.
window.addEventListener('focus', () => {
  if (_accentPref === 'system') applyAccent('system');
});

function updateThemeColorMeta(theme) {
  const isDark = theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = isDark ? '#1c1f26' : '#f2f3f7';
  document.head.appendChild(meta);
}

// Écoute les changements système quand le thème est en mode "auto"
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (localStorage.getItem('gm-theme') === 'auto') setTheme('auto');
});

// ── Bootstrap ─────────────────────────────────────────────────
async function init() {
  // 2. i18n
  const savedLocale = localStorage.getItem('gm-locale') || 'fr';
  await initI18n(savedLocale);

  // 3. Initialisation DB (seed exercices + profil par défaut)
  await initDB();

  // Sync le thème depuis le profil DB (priorité sur localStorage)
  const profile = await dbGetProfile();
  const savedTheme = profile?.theme ?? localStorage.getItem('gm-theme') ?? 'dark';
  setTheme(savedTheme);
  applyAccent(profile?.settings?.accentColor ?? localStorage.getItem('gm-accent') ?? 'default');

  // 4. Bottom nav
  const navEl = document.getElementById('bottom-nav');
  const nav = new BottomNav(navEl);
  nav.render();

  // 5. Routeur
  initRouter();

  // 6. Session overlay (persistant, écoute l'événement 'start-session')
  const sessionOverlay = new SessionOverlay();
  document.getElementById('app').addEventListener('start-session', async (e) => {
    // detail.routine : objet routine éphémère (ex. « Refaire cette séance »
    // depuis l'historique) — detail.routineId : routine persistée en base.
    await sessionOverlay.start(e.detail?.routine ?? e.detail?.routineId ?? null);
  });

  // 6b. Reprise d'une séance interrompue (brouillon localStorage
  // 'gm-active-session'). Choix : reprise automatique en mode minimisé
  // (barre de session visible, chrono recalculé depuis startTime) — moins
  // intrusif qu'un confirm() bloquant au démarrage ; l'utilisateur peut
  // toujours annuler la séance depuis l'overlay.
  try {
    await sessionOverlay.resumeDraft();
  } catch (err) {
    console.warn('[App] Reprise de séance impossible :', err);
  }

  // 8. iOS: show install banner after a short delay (no beforeinstallprompt on Safari)
  if (_isIOS && !_isStandalone) {
    setTimeout(_showInstallBanner, 3000);
  }

  // 7. Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .then(reg => console.log('[SW] Enregistré :', reg.scope))
      .catch(err => console.warn('[SW] Échec :', err));
  }
}

// ── PWA Install prompt ────────────────────────────────────────

/** Deferred beforeinstallprompt event (Chrome / Android / Edge). */
let _installPrompt = null;

/** Detect iOS Safari (no beforeinstallprompt support). */
const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

/** True if the app is already running as an installed PWA. */
const _isStandalone =
  window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

// Capture the prompt ASAP — fires before init() completes on some browsers.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _installPrompt = e;
  _showInstallBanner();
  // Informe les vues ouvertes (ex. paramètres) que l'installation est possible
  window.dispatchEvent(new CustomEvent('gm-install-available'));
});

window.addEventListener('appinstalled', () => {
  _hideInstallBanner();
  _installPrompt = null;
  localStorage.removeItem('gm-install-dismissed');
});

function _showInstallBanner() {
  if (_isStandalone) return;

  // Respect 7-day dismissal cooldown
  const dismissed = localStorage.getItem('gm-install-dismissed');
  if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 3600 * 1000) return;

  const banner = document.getElementById('install-banner');
  if (!banner) return;

  if (_isIOS) {
    // iOS: manual instructions (share → Add to Home Screen)
    banner.innerHTML = `
      <div class="install-banner__inner">
        <div class="install-banner__info">
          <i class="fa-solid fa-arrow-up-from-bracket install-banner__icon"></i>
          <div>
            <div class="install-banner__title">Installer Gros Monsieur</div>
            <div class="install-banner__sub">
              Appuyez sur <i class="fa-solid fa-arrow-up-from-bracket" style="font-size:10px;"></i>
              puis "Sur l'écran d'accueil"
            </div>
          </div>
        </div>
        <button class="install-banner__dismiss-btn" id="install-dismiss" aria-label="Fermer">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`;
  } else {
    // Chrome / Android / Edge: native install prompt
    banner.innerHTML = `
      <div class="install-banner__inner">
        <div class="install-banner__info">
          <i class="fa-solid fa-mobile-screen install-banner__icon"></i>
          <div>
            <div class="install-banner__title">Installer Gros Monsieur</div>
            <div class="install-banner__sub">Accès rapide depuis l'écran d'accueil</div>
          </div>
        </div>
        <div class="install-banner__actions">
          <button class="install-banner__install-btn" id="install-btn">Installer</button>
          <button class="install-banner__dismiss-btn" id="install-dismiss" aria-label="Fermer">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>`;

    document.getElementById('install-btn')?.addEventListener('click', async () => {
      if (!_installPrompt) return;
      _installPrompt.prompt();
      const { outcome } = await _installPrompt.userChoice;
      _installPrompt = null;
      if (outcome === 'accepted') _hideInstallBanner();
    });
  }

  document.getElementById('install-dismiss')?.addEventListener('click', () => {
    localStorage.setItem('gm-install-dismissed', String(Date.now()));
    _hideInstallBanner();
  });

  // Slide in with animation
  requestAnimationFrame(() =>
    requestAnimationFrame(() => banner.classList.add('install-banner--visible'))
  );
}

function _hideInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (!banner) return;
  banner.classList.remove('install-banner--visible');
}

// ── API d'installation manuelle (utilisée par la page Paramètres) ──────────

/**
 * État de l'installation PWA :
 *  - 'installed'   : déjà lancée en standalone
 *  - 'available'   : beforeinstallprompt capturé → requestInstall() possible
 *  - 'ios'         : Safari iOS (installation manuelle via Partager)
 *  - 'unavailable' : le navigateur n'a pas (encore) proposé l'installation
 */
export function getInstallState() {
  if (_isStandalone) return 'installed';
  if (_installPrompt) return 'available';
  if (_isIOS) return 'ios';
  return 'unavailable';
}

/**
 * Déclenche le prompt d'installation natif (Chrome/Edge/Android).
 * Retourne 'accepted' | 'dismissed' | null si aucun prompt disponible.
 * Contourne volontairement le cooldown du bandeau : c'est une action
 * explicite de l'utilisateur.
 */
export async function requestInstall() {
  if (!_installPrompt) return null;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  if (outcome === 'accepted') {
    _installPrompt = null;
    _hideInstallBanner();
  }
  return outcome;
}

init().catch(err => {
  console.error('[App] Erreur d\'initialisation :', err);
  document.getElementById('page-container').innerHTML = `
    <div class="page">
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation empty-state__icon"></i>
        <p class="empty-state__title">Erreur de démarrage</p>
        <p class="empty-state__text">${err.message}</p>
      </div>
    </div>`;
});
