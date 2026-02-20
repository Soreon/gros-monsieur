import { t } from '../i18n.js';

export default class MesurerPage {
  constructor(container) { this.container = container; }

  async render() {
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">${t('measure.title')}</h1>
        </div>
        <div class="empty-state">
          <i class="fa-solid fa-ruler-vertical empty-state__icon"></i>
          <p class="empty-state__title">${t('measure.title')}</p>
          <p class="empty-state__text">Phase 7 — en construction</p>
        </div>
      </div>`;
  }
}
