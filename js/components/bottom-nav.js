/**
 * BottomNav — Barre de navigation basse
 * 5 onglets : Profil | Historique | Entraînement | Exercices | Mesurer
 */

import { t } from '../i18n.js';
import { navigate, getCurrentRoute } from '../router.js';

const NAV_ITEMS = [
  { route: 'profil',       icon: 'fa-solid fa-user',              labelKey: 'nav.profile'   },
  { route: 'historique',   icon: 'fa-solid fa-clock-rotate-left', labelKey: 'nav.history'   },
  { route: 'entrainement', icon: 'fa-solid fa-dumbbell',          labelKey: 'nav.workout'   },
  { route: 'exercices',    icon: 'fa-solid fa-list',              labelKey: 'nav.exercises' },
  { route: 'mesurer',      icon: 'fa-solid fa-ruler-vertical',    labelKey: 'nav.measure'   },
];

export class BottomNav {
  constructor(el) {
    this.el = el;
  }

  render() {
    const current = getCurrentRoute();

    this.el.innerHTML = NAV_ITEMS.map(item => {
      const isActive = item.route === current;
      return `
        <button
          class="bottom-nav__item${isActive ? ' active' : ''}"
          data-route="${item.route}"
          aria-label="${t(item.labelKey)}"
          aria-current="${isActive ? 'page' : 'false'}"
          type="button"
        >
          <i class="${item.icon} bottom-nav__icon" aria-hidden="true"></i>
          <span class="bottom-nav__label">${t(item.labelKey)}</span>
        </button>`;
    }).join('');

    // Délégation d'événements
    this.el.addEventListener('click', e => {
      const btn = e.target.closest('.bottom-nav__item');
      if (btn?.dataset.route) {
        navigate(btn.dataset.route);
      }
    });
  }
}
