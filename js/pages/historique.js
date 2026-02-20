import { t } from '../i18n.js';

export default class HistoriquePage {
  constructor(container) { this.container = container; }

  async render() {
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">${t('history.title')}</h1>
        </div>
        <div class="empty-state">
          <i class="fa-solid fa-clock-rotate-left empty-state__icon"></i>
          <p class="empty-state__title">${t('history.empty')}</p>
          <p class="empty-state__text">${t('history.empty_sub')}</p>
        </div>
      </div>`;
  }
}
