/**
 * Router — Gros Monsieur
 * Routeur SPA hash-based simple.
 * Routes : #profil | #historique | #entrainement | #exercices | #mesurer
 *
 * Phase 10 additions:
 *  - Scroll restoration : mémorise le scrollTop par route, le restaure à la navigation retour.
 *  - Animations directionnelles : slide-right quand on navigue vers un onglet de droite,
 *    slide-left vers un onglet de gauche, basé sur l'ordre de la bottom nav.
 */

const ROUTES = {
  'profil':       () => import('./pages/profil.js'),
  'historique':   () => import('./pages/historique.js'),
  'entrainement': () => import('./pages/entrainement.js'),
  'exercices':    () => import('./pages/exercices.js'),
  'mesurer':      () => import('./pages/mesurer.js'),
};

/** Ordre des onglets — détermine la direction de l'animation de transition. */
const ROUTE_ORDER = ['profil', 'historique', 'entrainement', 'exercices', 'mesurer'];

const DEFAULT_ROUTE = 'profil';

let currentPage  = null;
let currentRoute = null;

/** Positions de scroll mémorisées par route. */
const _scrollPositions = {};

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
  const route  = getCurrentRoute();
  const loader = ROUTES[route] ?? ROUTES[DEFAULT_ROUTE];
  const container = document.getElementById('page-container');

  // ── Direction de l'animation ──────────────────────────────────────────────
  const prevIdx = ROUTE_ORDER.indexOf(currentRoute);
  const nextIdx = ROUTE_ORDER.indexOf(route);
  let direction = 'none';
  if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) {
    direction = nextIdx > prevIdx ? 'right' : 'left';
  }

  // ── Mémorise le scroll de la page sortante ────────────────────────────────
  if (currentRoute) {
    _scrollPositions[currentRoute] = container.scrollTop;
  }

  // Met à jour la nav active
  document.querySelectorAll('.bottom-nav__item').forEach(item => {
    item.classList.toggle('active', item.dataset.route === route);
    item.setAttribute('aria-current', item.dataset.route === route ? 'page' : 'false');
  });

  try {
    // Détruit la page courante
    if (currentPage?.destroy) currentPage.destroy();
    container.innerHTML = '';
    currentRoute = route;

    // Charge et instancie la nouvelle page
    const module = await loader();
    const PageClass = module.default;
    currentPage = new PageClass(container);
    await currentPage.render();

    // ── Animation directionnelle ──────────────────────────────────────────
    // On applique toujours une classe d'animation (jamais via CSS sur .page directement),
    // et on ne la retire JAMAIS : le DOM est remplacé à la prochaine navigation de toute façon.
    // Retirer la classe déclencherait un re-render de l'animation de base → flash visible.
    const pageEl = container.querySelector('.page');
    if (pageEl) {
      pageEl.classList.add(direction !== 'none' ? `page--slide-${direction}` : 'page--enter');
    }

    // ── Restaure le scroll ────────────────────────────────────────────────
    const savedScroll = _scrollPositions[route] ?? 0;
    container.scrollTop = savedScroll;
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
