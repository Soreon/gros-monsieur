/**
 * Service Worker — Gros Monsieur
 * Stratégie : Cache-first pour les assets statiques.
 * Le shell et Font Awesome Pro sont mis en cache dès l'installation.
 */

const CACHE_VERSION = 'gm-v17';

// Assets à mettre en cache lors de l'installation (app shell)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/reset.css',
  './css/layout.css',
  './css/components.css',
  './css/pages/exercices.css',
  './css/pages/historique.css',
  './css/pages/entrainement.css',
  './css/pages/session.css',
  './css/pages/profil.css',
  './css/pages/mesurer.css',
  './js/app.js',
  './js/router.js',
  './js/i18n.js',
  './js/db.js',
  './js/store.js',
  './js/components/bottom-nav.js',
  './js/components/modal.js',
  './js/pages/profil.js',
  './js/pages/historique.js',
  './js/pages/entrainement.js',
  './js/pages/session.js',
  './js/pages/exercices.js',
  './js/pages/mesurer.js',
  './js/data/locales/fr.js',
  './js/data/locales/en.js',
  './js/data/exercises-seed.js',
  './js/utils/helpers.js',
  './js/utils/export.js',
  './js/utils/chart.js',
  './js/utils/strong-import.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  // Font Awesome Pro (local, sous-ensemble — régénérer via tools/subset-fontawesome.mjs)
  './assets/fontawesome/css/fa-subset.min.css',
  './assets/fontawesome/webfonts/fa-solid-900.subset.woff2',
  './assets/fontawesome/webfonts/fa-regular-400.subset.woff2',
];

// ── Installation : mise en cache du shell ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activation : suppression des anciens caches ────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch : cache-first ────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Ignore les requêtes non-GET
  if (event.request.method !== 'GET') return;

  // Ignore les requêtes vers d'autres origines
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        // Pas en cache → réseau + mise en cache dynamique
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const toCache = response.clone();
            // Fire-and-forget mais catché : un échec (quota plein) ne doit pas
            // produire de rejet non géré.
            caches.open(CACHE_VERSION)
              .then(cache => cache.put(event.request, toCache))
              .catch(() => {});
            return response;
          })
          .catch(() => {
            // Offline + pas en cache : retourne index.html pour les navigations
            if (event.request.mode === 'navigate') {
              return caches.match(new URL('./index.html', self.location).href);
            }
          });
      })
  );
});
