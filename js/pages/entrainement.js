import { t } from '../i18n.js';

export default class EntrainementPage {
  constructor(container) { this.container = container; }

  async render() {
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">${t('workout.title')}</h1>
          <div class="page-actions">
            <button class="btn btn--icon" aria-label="${t('workout.new_routine')}">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
        <div class="empty-state">
          <i class="fa-solid fa-dumbbell empty-state__icon"></i>
          <p class="empty-state__title">${t('workout.empty')}</p>
          <p class="empty-state__text">${t('workout.empty_sub')}</p>
        </div>
      </div>`;
  }
}
