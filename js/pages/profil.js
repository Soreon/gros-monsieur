import { t } from '../i18n.js';

export default class ProfilPage {
  constructor(container) { this.container = container; }

  async render() {
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">${t('profile.title')}</h1>
          <div class="page-actions">
            <button class="btn btn--icon" aria-label="${t('profile.settings')}">
              <i class="fa-solid fa-gear"></i>
            </button>
          </div>
        </div>
        <div class="empty-state">
          <i class="fa-solid fa-user empty-state__icon"></i>
          <p class="empty-state__title">${t('profile.title')}</p>
          <p class="empty-state__text">Phase 8 — en construction</p>
        </div>
      </div>`;
  }
}
