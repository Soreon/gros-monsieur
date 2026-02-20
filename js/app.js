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

  // 7. Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .then(reg => console.log('[SW] Enregistré :', reg.scope))
      .catch(err => console.warn('[SW] Échec :', err));
  }
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
