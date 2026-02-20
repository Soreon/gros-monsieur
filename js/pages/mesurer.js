// =============================================================================
// js/pages/mesurer.js — Measure page
// =============================================================================

import { t } from '../i18n.js';
import { uid, formatDate, formatDateShort } from '../utils/helpers.js';
import {
  dbGetAllMeasurements,
  dbPutMeasurement,
  dbDelete,
} from '../db.js';

// ---------------------------------------------------------------------------
// Local helper
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a delta value to at most 1 decimal, stripping trailing ".0".
 * e.g. 1.5 → "1.5", 2.0 → "2", 0.3 → "0.3"
 * @param {number} abs - Absolute value of the delta
 * @returns {string}
 */
function formatDelta(abs) {
  const str = abs.toFixed(1);
  return str.endsWith('.0') ? str.slice(0, -2) : str;
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

const GENERAL_TYPES = [
  { key: 'weight',   unit: 'kg',   icon: 'fa-solid fa-weight-scale' },
  { key: 'body_fat', unit: '%',    icon: 'fa-solid fa-droplet' },
  { key: 'calories', unit: 'kcal', icon: 'fa-solid fa-fire' },
];

const BODY_TYPES = [
  { key: 'neck',          unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'shoulders',     unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'chest',         unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'bicep_left',    unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'bicep_right',   unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'forearm_left',  unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'forearm_right', unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'waist',         unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'hips',          unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'thigh_left',    unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'thigh_right',   unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'calf_left',     unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
  { key: 'calf_right',    unit: 'cm', icon: 'fa-solid fa-ruler-horizontal' },
];

// =============================================================================
// Page class
// =============================================================================

export default class MesurerPage {
  constructor(container) {
    this.container = container;

    // State
    this._view          = 'tabs';      // 'tabs' | 'history'
    this._activeTab     = 'general';   // 'general' | 'body_parts'
    this._selectedType  = null;        // type key when view = 'history'
    this._measurements  = [];          // all from DB

    // Long-press tracking
    this._pressTimer   = null;
    this._pressStartX  = 0;
    this._pressStartY  = 0;
    this._pressingEl   = null;

    // Document-level handlers (removed in destroy())
    this._handlers = {};
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async render() {
    await this._loadMeasurements();
    this._render();
  }

  destroy() {
    for (const [event, handler] of Object.entries(this._handlers)) {
      document.removeEventListener(event, handler);
    }
    this._handlers = {};
    this._clearPressTimer();
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async _loadMeasurements() {
    this._measurements = await dbGetAllMeasurements();
  }

  // ---------------------------------------------------------------------------
  // Sub-view router
  // ---------------------------------------------------------------------------

  _render() {
    if (this._view === 'history' && this._selectedType) {
      this._renderHistory();
    } else {
      this._view = 'tabs';
      this._renderTabs();
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the entries for a given type, sorted date descending.
   * @param {string} typeKey
   * @returns {object[]}
   */
  _entriesForType(typeKey) {
    return this._measurements
      .filter(m => m.type === typeKey)
      .sort((a, b) => b.date - a.date);
  }

  /**
   * Returns the type definition object for a key, searching both lists.
   * @param {string} typeKey
   * @returns {object|undefined}
   */
  _typeDef(typeKey) {
    return (
      GENERAL_TYPES.find(t => t.key === typeKey) ||
      BODY_TYPES.find(t => t.key === typeKey)
    );
  }

  // ---------------------------------------------------------------------------
  // TABS VIEW
  // ---------------------------------------------------------------------------

  _renderTabs() {
    const types = this._activeTab === 'general' ? GENERAL_TYPES : BODY_TYPES;

    const tabsHtml = `
      <div class="measure-tabs" role="tablist">
        <button
          class="measure-tab${this._activeTab === 'general' ? ' measure-tab--active' : ''}"
          data-tab="general"
          role="tab"
          aria-selected="${this._activeTab === 'general'}"
        >
          <i class="fa-solid fa-ruler-vertical"></i>
          ${t('measure.general')}
        </button>
        <button
          class="measure-tab${this._activeTab === 'body_parts' ? ' measure-tab--active' : ''}"
          data-tab="body_parts"
          role="tab"
          aria-selected="${this._activeTab === 'body_parts'}"
        >
          <i class="fa-solid fa-ruler-horizontal"></i>
          ${t('measure.body_parts')}
        </button>
      </div>`;

    const cardsHtml = types
      .map(typeDef => this._metricCardHtml(typeDef))
      .join('');

    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">${t('measure.title')}</h1>
        </div>
        ${tabsHtml}
        <div class="measure-grid">
          ${cardsHtml}
        </div>
      </div>`;

    this._bindTabsEvents();
  }

  _metricCardHtml(typeDef) {
    const entries = this._entriesForType(typeDef.key);
    const hasData = entries.length > 0;

    let valueHtml;
    let deltaHtml = '';

    if (hasData) {
      const latest = entries[0];
      valueHtml = `
        <span class="measure-card__value">
          ${escapeHtml(String(latest.value))} ${escapeHtml(t('unit.' + this._unitKey(typeDef.unit)))}
        </span>`;

      if (entries.length >= 2) {
        const delta = latest.value - entries[1].value;
        const absStr = formatDelta(Math.abs(delta));
        if (delta > 0) {
          const label = t('measure.delta_up').replace('{v}', absStr);
          deltaHtml = `<span class="measure-card__delta measure-card__delta--up">${escapeHtml(label)}</span>`;
        } else if (delta < 0) {
          const label = t('measure.delta_down').replace('{v}', absStr);
          deltaHtml = `<span class="measure-card__delta measure-card__delta--down">${escapeHtml(label)}</span>`;
        }
      }
    } else {
      valueHtml = `<span class="measure-card__no-data">${t('measure.no_data')}</span>`;
    }

    return `
      <div class="measure-card" data-type="${escapeHtml(typeDef.key)}" role="button" tabindex="0">
        <i class="${escapeHtml(typeDef.icon)} measure-card__icon"></i>
        <span class="measure-card__label">${escapeHtml(t('mtype.' + typeDef.key))}</span>
        ${valueHtml}
        ${deltaHtml}
        <button
          class="measure-card__add-btn icon-btn"
          data-add-type="${escapeHtml(typeDef.key)}"
          aria-label="${escapeHtml(t('measure.add_entry'))}"
        >
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>`;
  }

  /**
   * Maps a unit string to the i18n key suffix used by t('unit.*').
   * @param {string} unit
   * @returns {string}
   */
  _unitKey(unit) {
    if (unit === 'kg')   return 'kg';
    if (unit === '%')    return 'pct';
    if (unit === 'kcal') return 'kcal';
    if (unit === 'cm')   return 'cm';
    return unit;
  }

  // ---------------------------------------------------------------------------
  // Tabs event binding
  // ---------------------------------------------------------------------------

  _bindTabsEvents() {
    const page = this.container.querySelector('.page');
    if (!page) return;

    // Tab switching
    page.addEventListener('click', e => {
      const tabBtn = e.target.closest('.measure-tab');
      if (tabBtn) {
        const tab = tabBtn.dataset.tab;
        if (tab && tab !== this._activeTab) {
          this._activeTab = tab;
          this._renderTabs();
        }
        return;
      }

      // Add button on card
      const addBtn = e.target.closest('.measure-card__add-btn');
      if (addBtn) {
        e.stopPropagation();
        const typeKey = addBtn.dataset.addType;
        if (typeKey) this._showAddModal(typeKey);
        return;
      }

      // Card tap → navigate to history
      const card = e.target.closest('.measure-card');
      if (card) {
        const typeKey = card.dataset.type;
        if (typeKey) {
          this._selectedType = typeKey;
          this._view = 'history';
          this._render();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // HISTORY VIEW
  // ---------------------------------------------------------------------------

  _renderHistory() {
    const typeKey = this._selectedType;
    const typeDef = this._typeDef(typeKey);
    const entries = this._entriesForType(typeKey); // sorted date desc

    const typeName = typeDef ? t('mtype.' + typeKey) : escapeHtml(typeKey);

    let contentHtml;

    if (entries.length === 0) {
      contentHtml = `
        <div class="empty-state">
          <i class="fa-solid fa-ruler-vertical empty-state__icon"></i>
          <p class="empty-state__title">${t('state.empty')}</p>
        </div>`;
    } else {
      const rowsHtml = entries
        .map((entry, idx) => this._historyEntryHtml(entry, entries, idx))
        .join('');
      contentHtml = `
        <div class="measure-history__list">
          ${rowsHtml}
        </div>`;
    }

    this.container.innerHTML = `
      <div class="page">
        <div class="measure-history__header">
          <button class="icon-btn" id="measure-back-btn" aria-label="${t('action.back')}">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="page-title">${escapeHtml(typeName)}</span>
          <button
            class="icon-btn"
            id="measure-history-add-btn"
            data-add-type="${escapeHtml(typeKey)}"
            aria-label="${t('measure.add_entry')}"
          >
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
        <div class="measure-history">
          ${contentHtml}
        </div>
      </div>`;

    this._bindHistoryEvents();
  }

  /**
   * Renders one history entry row.
   * @param {object} entry   - Current entry
   * @param {object[]} entries - All entries for this type, date desc
   * @param {number} idx     - Index of current entry in the array
   * @returns {string}
   */
  _historyEntryHtml(entry, entries, idx) {
    const dateStr = formatDateShort(entry.date);
    const unit    = entry.unit;

    // Delta vs the previous entry in the list (which is older, higher idx)
    let deltaHtml = '';
    if (idx < entries.length - 1) {
      const prevEntry = entries[idx + 1];
      const delta = entry.value - prevEntry.value;
      if (delta !== 0) {
        const absStr = formatDelta(Math.abs(delta));
        if (delta > 0) {
          const label = t('measure.delta_up').replace('{v}', absStr);
          deltaHtml = `<span class="measure-entry__delta measure-card__delta--up">${escapeHtml(label)}</span>`;
        } else {
          const label = t('measure.delta_down').replace('{v}', absStr);
          deltaHtml = `<span class="measure-entry__delta measure-card__delta--down">${escapeHtml(label)}</span>`;
        }
      }
    }

    return `
      <div class="measure-entry" data-entry-id="${escapeHtml(entry.id)}">
        <span class="measure-entry__date">${escapeHtml(dateStr)}</span>
        <span class="measure-entry__value">${escapeHtml(String(entry.value))} ${escapeHtml(unit)}</span>
        ${deltaHtml}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // History event binding (delegation + long-press)
  // ---------------------------------------------------------------------------

  _bindHistoryEvents() {
    // Back button
    const backBtn = this.container.querySelector('#measure-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this._view = 'tabs';
        this._selectedType = null;
        this._render();
      });
    }

    // Add button in header
    const addBtn = this.container.querySelector('#measure-history-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const typeKey = addBtn.dataset.addType;
        if (typeKey) this._showAddModal(typeKey);
      });
    }

    // Long-press on entries for delete
    const list = this.container.querySelector('.measure-history__list');
    if (!list) return;

    list.addEventListener('pointerdown', e => {
      const entry = e.target.closest('.measure-entry');
      if (!entry) return;

      this._pressStartX = e.clientX;
      this._pressStartY = e.clientY;
      this._pressingEl  = entry;
      entry.classList.add('measure-entry--pressing');

      this._pressTimer = setTimeout(() => {
        this._pressTimer = null;
        entry.classList.remove('measure-entry--pressing');
        this._pressingEl = null;
        const id = entry.dataset.entryId;
        if (id) this._showDeleteModal(id);
      }, 500);
    });

    list.addEventListener('pointermove', e => {
      if (!this._pressTimer) return;
      const dx = Math.abs(e.clientX - this._pressStartX);
      const dy = Math.abs(e.clientY - this._pressStartY);
      if (dx > 5 || dy > 5) {
        this._clearPressTimer();
      }
    });

    const cancelPress = () => this._clearPressTimer();
    list.addEventListener('pointerup',     cancelPress);
    list.addEventListener('pointercancel', cancelPress);
  }

  _clearPressTimer() {
    if (this._pressTimer) {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
    if (this._pressingEl) {
      this._pressingEl.classList.remove('measure-entry--pressing');
      this._pressingEl = null;
    }
  }

  // ---------------------------------------------------------------------------
  // ADD ENTRY MODAL
  // ---------------------------------------------------------------------------

  _showAddModal(typeKey) {
    const typeDef = this._typeDef(typeKey);
    if (!typeDef) return;

    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    const typeName  = t('mtype.' + typeKey);
    const todayStr  = new Date().toISOString().slice(0, 10);

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="measure-modal-title">
        <div class="modal__header">
          <h2 class="modal__title" id="measure-modal-title">
            ${escapeHtml(t('measure.add_entry'))} — ${escapeHtml(typeName)}
          </h2>
        </div>
        <div class="modal__body">
          <div class="form-group">
            <label class="form-label" for="measure-value-input">
              ${escapeHtml(typeName)} (${escapeHtml(typeDef.unit)})
            </label>
            <input
              class="form-input"
              id="measure-value-input"
              type="number"
              inputmode="decimal"
              min="0"
              step="0.1"
              placeholder="0"
              autocomplete="off"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="measure-date-input">
              ${escapeHtml(formatDate(Date.now()))}
            </label>
            <input
              class="form-input"
              id="measure-date-input"
              type="date"
              value="${escapeHtml(todayStr)}"
            />
          </div>
          <p class="measure-modal__error" id="measure-modal-error" style="display:none;color:var(--color-danger,red);margin-top:0.5rem;"></p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="measure-modal-cancel">
            ${t('action.cancel')}
          </button>
          <button class="btn btn--primary" id="measure-modal-save">
            ${t('action.save')}
          </button>
        </div>
      </div>`;

    overlay.classList.add('modal-overlay--visible');
    overlay.style.display = 'flex';

    // Focus value input immediately
    const valueInput = overlay.querySelector('#measure-value-input');
    if (valueInput) setTimeout(() => valueInput.focus(), 50);

    const closeModal = () => {
      overlay.style.display = 'none';
      overlay.classList.remove('modal-overlay--visible');
      overlay.innerHTML = '';
    };

    const cancelBtn = overlay.querySelector('#measure-modal-cancel');
    const saveBtn   = overlay.querySelector('#measure-modal-save');
    const errorEl   = overlay.querySelector('#measure-modal-error');
    const dateInput = overlay.querySelector('#measure-date-input');

    cancelBtn.addEventListener('click', closeModal);

    saveBtn.addEventListener('click', async () => {
      const rawValue = valueInput ? valueInput.value.trim() : '';
      const rawDate  = dateInput  ? dateInput.value  : '';
      const parsed   = parseFloat(rawValue);

      if (!rawValue || isNaN(parsed) || parsed <= 0) {
        if (errorEl) {
          errorEl.textContent = t('measure.add_entry');
          errorEl.style.display = 'block';
        }
        if (valueInput) valueInput.focus();
        return;
      }

      const dateTs = rawDate
        ? new Date(rawDate).getTime()
        : Date.now();

      const obj = {
        id:        uid(),
        type:      typeKey,
        value:     parsed,
        unit:      typeDef.unit,
        date:      dateTs,
        createdAt: Date.now(),
      };

      await dbPutMeasurement(obj);
      await this._loadMeasurements();
      closeModal();
      this._render();
    });

    // Close on backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    }, { once: true });
  }

  // ---------------------------------------------------------------------------
  // DELETE CONFIRMATION MODAL
  // ---------------------------------------------------------------------------

  _showDeleteModal(entryId) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="measure-del-title">
        <div class="modal__header">
          <h2 class="modal__title" id="measure-del-title">
            ${t('action.delete')}
          </h2>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="measure-del-cancel">
            ${t('action.cancel')}
          </button>
          <button class="btn btn--danger" id="measure-del-confirm">
            <i class="fa-solid fa-trash"></i>
            ${t('action.delete')}
          </button>
        </div>
      </div>`;

    overlay.classList.add('modal-overlay--visible');
    overlay.style.display = 'flex';

    const closeModal = () => {
      overlay.style.display = 'none';
      overlay.classList.remove('modal-overlay--visible');
      overlay.innerHTML = '';
    };

    const cancelBtn  = overlay.querySelector('#measure-del-cancel');
    const confirmBtn = overlay.querySelector('#measure-del-confirm');

    cancelBtn.addEventListener('click', closeModal);

    confirmBtn.addEventListener('click', async () => {
      await dbDelete('measurements', entryId);
      closeModal();
      await this._loadMeasurements();
      this._render();
    });

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    }, { once: true });
  }
}
