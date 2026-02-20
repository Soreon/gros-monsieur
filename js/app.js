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

// ── 1. Thème ─────────────────────────────────────────────────
// Appliqué immédiatement (avant le premier paint) depuis localStorage
// pour éviter le flash de thème incorrect.
(function applyInitialTheme() {
  const theme = localStorage.getItem('gm-theme') || 'dark';
  setTheme(theme);
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
}

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

  // 4. Bottom nav
  const navEl = document.getElementById('bottom-nav');
  const nav = new BottomNav(navEl);
  nav.render();

  // 5. Routeur
  initRouter();

  // 6. Session overlay (persistant, écoute l'événement 'start-session')
  const sessionOverlay = new SessionOverlay();
  document.getElementById('app').addEventListener('start-session', async (e) => {
    await sessionOverlay.start(e.detail?.routineId ?? null);
  });

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
