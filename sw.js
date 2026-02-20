/**
 * Service Worker — Gros Monsieur
 * Stratégie : Cache-first pour les assets statiques.
 * Le shell et Font Awesome Pro sont mis en cache dès l'installation.
 */

const CACHE_VERSION = 'gm-v2';

// Assets à mettre en cache lors de l'installation (app shell)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/variables.css',
  '/css/reset.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/js/router.js',
  '/js/i18n.js',
  '/js/db.js',
  '/js/store.js',
  '/js/components/bottom-nav.js',
  '/js/pages/profil.js',
  '/js/pages/historique.js',
  '/js/pages/entrainement.js',
  '/js/pages/exercices.js',
  '/js/pages/mesurer.js',
  '/js/data/locales/fr.js',
  '/js/data/locales/en.js',
  '/js/data/exercises-seed.js',
  '/js/utils/helpers.js',
  '/js/utils/export.js',
  '/assets/icons/icon.svg',
  // Font Awesome Pro (local)
  '/assets/fontawesome/css/fontawesome.min.css',
  '/assets/fontawesome/css/solid.min.css',
  '/assets/fontawesome/css/regular.min.css',
  '/assets/fontawesome/webfonts/fa-solid-900.woff2',
  '/assets/fontawesome/webfonts/fa-regular-400.woff2',
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
            caches.open(CACHE_VERSION)
              .then(cache => cache.put(event.request, toCache));
            return response;
          })
          .catch(() => {
            // Offline + pas en cache : retourne index.html pour les navigations
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
          });
      })
  );
});
