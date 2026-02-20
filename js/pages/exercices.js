import { t } from '../i18n.js';

export default class ExercicesPage {
  constructor(container) { this.container = container; }

  async render() {
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">${t('exercises.title')}</h1>
          <div class="page-actions">
            <button class="btn btn--icon" aria-label="${t('action.search')}">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
            <button class="btn btn--icon" aria-label="${t('action.filter')}">
              <i class="fa-solid fa-sliders"></i>
            </button>
            <button class="btn btn--icon" aria-label="${t('action.sort')}">
              <i class="fa-solid fa-arrow-up-arrow-down"></i>
            </button>
            <button class="btn btn--icon" aria-label="Plus">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
          </div>
        </div>
        <div class="empty-state">
          <i class="fa-solid fa-list empty-state__icon"></i>
          <p class="empty-state__title">${t('exercises.title')}</p>
          <p class="empty-state__text">Phase 3 — en construction</p>
        </div>
      </div>`;
  }
}
