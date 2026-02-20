/**
 * Router — Gros Monsieur
 * Routeur SPA hash-based simple.
 * Routes : #profil | #historique | #entrainement | #exercices | #mesurer
 */

const ROUTES = {
  'profil':       () => import('./pages/profil.js'),
  'historique':   () => import('./pages/historique.js'),
  'entrainement': () => import('./pages/entrainement.js'),
  'exercices':    () => import('./pages/exercices.js'),
  'mesurer':      () => import('./pages/mesurer.js'),
};

const DEFAULT_ROUTE = 'profil';

let currentPage = null;

/** Initialise le routeur. Doit être appelé après le rendu de la nav. */
export function initRouter() {
  window.addEventListener('hashchange', handleRoute);

  const hash = getCurrentRoute();
  if (!hash || !ROUTES[hash]) {
    location.hash = DEFAULT_ROUTE;
  } else {
    handleRoute();
  }
}

/** Navigue vers une route. */
export function navigate(route) {
  if (ROUTES[route]) {
    location.hash = route;
  } else {
    console.warn(`[Router] Route inconnue : "${route}"`);
  }
}

/** Retourne la route active depuis le hash. */
export function getCurrentRoute() {
  return location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE;
}

/** Charge et affiche la page correspondant au hash actuel. */
async function handleRoute() {
  const route = getCurrentRoute();
  const loader = ROUTES[route] ?? ROUTES[DEFAULT_ROUTE];
  const container = document.getElementById('page-container');

  // Met à jour la nav active
  document.querySelectorAll('.bottom-nav__item').forEach(item => {
    item.classList.toggle('active', item.dataset.route === route);
    item.setAttribute('aria-current', item.dataset.route === route ? 'page' : 'false');
  });

  try {
    // Détruit la page courante
    if (currentPage?.destroy) currentPage.destroy();
    container.innerHTML = '';

    // Charge et instancie la nouvelle page
    const module = await loader();
    const PageClass = module.default;
    currentPage = new PageClass(container);
    await currentPage.render();

    // Remet le scroll en haut
    container.scrollTop = 0;
  } catch (err) {
    console.error('[Router] Erreur de chargement de page :', err);
    container.innerHTML = `
      <div class="page">
        <div class="empty-state">
          <i class="fa-solid fa-triangle-exclamation empty-state__icon"></i>
          <p class="empty-state__title">Erreur de chargement</p>
          <p class="empty-state__text">${err.message}</p>
        </div>
      </div>`;
  }
}
