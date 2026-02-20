// =============================================================================
// js/pages/historique.js — History page
// =============================================================================

import { t } from '../i18n.js';
import { dbGetAllSessions, dbDelete } from '../db.js';
import {
  formatDuration,
  formatDate,
  formatDateShort,
  formatMonthYear,
  groupBy,
  formatWeight,
} from '../utils/helpers.js';

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

// Set type abbreviation
function setTypeAbbr(type) {
  if (type === 'warmup') return 'W';
  if (type === 'drop')   return 'D';
  return 'N';
}

// =============================================================================
// Page class
// =============================================================================

export default class HistoriquePage {
  constructor(container) {
    this.container = container;

    // State
    this._view            = 'list';   // 'list' | 'detail'
    this._sessions        = [];
    this._selectedSession = null;

    // Long-press tracking
    this._pressTimer    = null;
    this._pressStartX   = 0;
    this._pressStartY   = 0;
    this._pressingCard  = null;

    // Document-level handlers (removed in destroy())
    this._handlers = {};
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async render() {
    await this._loadSessions();
    this._render();
  }

  destroy() {
    // Remove any document-level listeners registered during this session
    for (const [event, handler] of Object.entries(this._handlers)) {
      document.removeEventListener(event, handler);
    }
    this._handlers = {};
    this._clearPressTimer();

    // Remove pull-to-refresh listeners
    if (this._ptrHandlers) {
      this.container.removeEventListener('touchstart', this._ptrHandlers.onTouchStart);
      this.container.removeEventListener('touchmove',  this._ptrHandlers.onTouchMove);
      this.container.removeEventListener('touchend',   this._ptrHandlers.onTouchEnd);
      this._ptrHandlers = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async _loadSessions() {
    const raw = await dbGetAllSessions();
    // Sort descending by startTime
    this._sessions = raw.sort((a, b) => b.startTime - a.startTime);
  }

  // ---------------------------------------------------------------------------
  // Routing between sub-views
  // ---------------------------------------------------------------------------

  _render() {
    if (this._view === 'detail' && this._selectedSession) {
      this._renderDetail(this._selectedSession);
    } else {
      this._view = 'list';
      this._renderList(this._sessions);
    }
  }

  // ---------------------------------------------------------------------------
  // LIST VIEW
  // ---------------------------------------------------------------------------

  _renderList(sessions) {
    if (sessions.length === 0) {
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
      return;
    }

    // Group by month (preserves insertion order → already sorted desc)
    const grouped = groupBy(sessions, s => formatMonthYear(s.startTime));

    let sectionsHtml = '';
    for (const [month, monthSessions] of grouped) {
      const countLabel = t('history.month_count').replace('{n}', monthSessions.length);
      sectionsHtml += `
        <section class="hist-month">
          <div class="hist-month__label">
            ${escapeHtml(month)}
            <span class="hist-month__count">${escapeHtml(countLabel)}</span>
          </div>
          ${monthSessions.map(s => this._sessionCardHtml(s)).join('')}
        </section>`;
    }

    this.container.innerHTML = `
      <div class="page">
        <div id="ptr-indicator" class="ptr-indicator">
          <i class="fa-solid fa-arrow-down ptr-indicator__icon"></i>
        </div>
        <div class="page-header">
          <h1 class="page-title">${t('history.title')}</h1>
        </div>
        <div class="hist-list">
          ${sectionsHtml}
        </div>
      </div>`;

    this._bindListEvents();
  }

  _sessionCardHtml(session) {
    const dateStr     = formatDateShort(session.startTime);
    const timeStr     = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationStr = formatDuration(session.duration);

    // Volume stat (only if > 0)
    const volumeHtml = session.totalVolume > 0
      ? `<span class="hist-card__stat">
           <i class="fa-solid fa-weight-hanging"></i>
           ${escapeHtml(formatWeight(session.totalVolume))}
         </span>`
      : '';

    // PR badge (only if > 0)
    const prBadgeHtml = session.prCount > 0
      ? `<span class="hist-card__pr-badge">
           <i class="fa-solid fa-trophy"></i>
           ${t('history.prs').replace('{n}', session.prCount)}
         </span>`
      : '';

    return `
      <article class="hist-card" data-session-id="${escapeHtml(session.id)}">
        <div class="hist-card__header">
          <span class="hist-card__name">${escapeHtml(session.name)}</span>
          ${prBadgeHtml}
        </div>
        <span class="hist-card__date">${escapeHtml(dateStr)} · ${escapeHtml(timeStr)}</span>
        <div class="hist-card__stats">
          <span class="hist-card__stat">
            <i class="fa-solid fa-stopwatch"></i>
            ${escapeHtml(durationStr)}
          </span>
          ${volumeHtml}
        </div>
      </article>`;
  }

  // ---------------------------------------------------------------------------
  // List event binding (delegation + long-press)
  // ---------------------------------------------------------------------------

  _bindListEvents() {
    const list = this.container.querySelector('.hist-list');
    if (!list) return;

    // ---- Pull-to-refresh ----
    this._initPullToRefresh();

    // ---- Long-press via pointer events ----
    list.addEventListener('pointerdown', e => {
      const card = e.target.closest('.hist-card');
      if (!card) return;

      this._pressStartX  = e.clientX;
      this._pressStartY  = e.clientY;
      this._pressingCard = card;
      card.classList.add('hist-card--pressing');

      this._pressTimer = setTimeout(() => {
        this._pressTimer = null;
        card.classList.remove('hist-card--pressing');
        this._pressingCard = null;
        const id = card.dataset.sessionId;
        this._showDeleteModal(id);
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

    // ---- Tap → detail view ----
    list.addEventListener('click', e => {
      // Ignore if a long-press just fired
      if (this._pressTimer === null && this._pressingCard) return;

      const card = e.target.closest('.hist-card');
      if (!card) return;

      const id      = card.dataset.sessionId;
      const session = this._sessions.find(s => s.id === id);
      if (!session) return;

      this._selectedSession = session;
      this._view = 'detail';
      this._render();
    });
  }

  _clearPressTimer() {
    if (this._pressTimer) {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
    if (this._pressingCard) {
      this._pressingCard.classList.remove('hist-card--pressing');
      this._pressingCard = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Pull-to-refresh
  // ---------------------------------------------------------------------------

  _initPullToRefresh() {
    const container  = this.container;  // scrollable element
    const THRESHOLD  = 60;              // px to pull before releasing triggers refresh

    let startY      = 0;
    let pulling     = false;
    let refreshing  = false;

    const indicator = document.getElementById('ptr-indicator');
    if (!indicator) return;

    const onTouchStart = (e) => {
      if (container.scrollTop > 0 || refreshing) return;
      startY  = e.touches[0].clientY;
      pulling = true;
    };

    const onTouchMove = (e) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { pulling = false; return; }

      // Prevent the browser's native pull-to-refresh
      if (e.cancelable) e.preventDefault();

      const ready = dy >= THRESHOLD;
      indicator.classList.toggle('ptr-indicator--pulling', true);
      indicator.classList.toggle('ptr-indicator--ready', ready);
    };

    const onTouchEnd = async () => {
      if (!pulling || refreshing) return;
      pulling = false;

      const ready = indicator.classList.contains('ptr-indicator--ready');
      indicator.classList.remove('ptr-indicator--pulling', 'ptr-indicator--ready');

      if (!ready) return;

      // Show spinner while refreshing
      refreshing = true;
      indicator.classList.add('ptr-indicator--refreshing');
      indicator.innerHTML = '<div class="ptr-indicator__spinner"></div>';

      await this._loadSessions();
      this._render();
      // _render() replaces the whole container HTML, so no need to clean up
      refreshing = false;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove',  onTouchMove,  { passive: false });
    container.addEventListener('touchend',   onTouchEnd,   { passive: true });

    // Store refs for destroy()
    this._ptrHandlers = { onTouchStart, onTouchMove, onTouchEnd };
  }

  // ---------------------------------------------------------------------------
  // DETAIL VIEW
  // ---------------------------------------------------------------------------

  _renderDetail(session) {
    const fullDate    = formatDate(session.startTime);
    const durationStr = formatDuration(session.duration);

    // Volume stat
    const volumeHtml = session.totalVolume > 0
      ? `<div class="hist-detail__stat">
           <span class="hist-detail__stat-value">${escapeHtml(formatWeight(session.totalVolume))}</span>
           <span class="hist-detail__stat-label"><i class="fa-solid fa-weight-hanging"></i></span>
         </div>`
      : '';

    // PR stat
    const prHtml = session.prCount > 0
      ? `<div class="hist-detail__stat">
           <span class="hist-detail__stat-value">${session.prCount}</span>
           <span class="hist-detail__stat-label"><i class="fa-solid fa-trophy"></i></span>
         </div>`
      : '';

    // Exercises
    const exercisesHtml = (session.exercises || [])
      .map(ex => this._exerciseHtml(ex))
      .join('');

    this.container.innerHTML = `
      <div class="page">
        <div class="hist-detail__header">
          <button class="icon-btn" id="hist-back-btn" aria-label="${t('action.back')}">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="hist-detail__title">${escapeHtml(session.name)}</span>
          <button class="icon-btn btn--danger" id="hist-delete-btn" aria-label="${t('action.delete')}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>

        <div class="hist-detail">
          <p class="hist-detail__date">${escapeHtml(fullDate)}</p>

          <div class="hist-detail__stats">
            <div class="hist-detail__stat">
              <span class="hist-detail__stat-value">${escapeHtml(durationStr)}</span>
              <span class="hist-detail__stat-label"><i class="fa-solid fa-stopwatch"></i></span>
            </div>
            ${volumeHtml}
            ${prHtml}
          </div>

          <div class="hist-detail__exercises">
            ${exercisesHtml}
          </div>
        </div>
      </div>`;

    this._bindDetailEvents(session.id);
  }

  _exerciseHtml(exercise) {
    // Best set info
    let bestSetHtml = '';
    if (exercise.bestSet) {
      const bs = exercise.bestSet;
      bestSetHtml = `
        <p class="hist-exercise__best-set">
          <i class="fa-solid fa-star"></i>
          ${t('session.best_set')} : ${escapeHtml(String(bs.weight))} kg × ${escapeHtml(String(bs.reps))}
        </p>`;
    }

    // Note
    const noteHtml = exercise.note
      ? `<p class="hist-exercise__note">${escapeHtml(exercise.note)}</p>`
      : '';

    // Sets table
    const setsHtml = (exercise.sets || [])
      .map(set => this._setRowHtml(set))
      .join('');

    return `
      <div class="hist-exercise">
        <p class="hist-exercise__name">${escapeHtml(exercise.exerciseName)}</p>
        ${bestSetHtml}
        ${noteHtml}
        <div class="hist-sets">
          ${setsHtml}
        </div>
      </div>`;
  }

  _setRowHtml(set) {
    const abbr       = setTypeAbbr(set.type);
    const valueStr   = `${escapeHtml(String(set.weight))} kg × ${escapeHtml(String(set.reps))}`;
    const incomplete = !set.completed ? ' hist-set-row--incomplete' : '';

    // Mark icon
    let markHtml;
    if (set.isPR) {
      markHtml = `<span class="hist-set-row__mark" title="${t('session.new_pr')}">
                    <i class="fa-solid fa-star"></i>
                  </span>`;
    } else if (set.completed) {
      markHtml = `<span class="hist-set-row__mark">
                    <i class="fa-solid fa-check"></i>
                  </span>`;
    } else {
      markHtml = `<span class="hist-set-row__mark">
                    <i class="fa-regular fa-circle"></i>
                  </span>`;
    }

    return `
      <div class="hist-set-row${incomplete}">
        <span class="hist-set-row__type">${escapeHtml(abbr)}</span>
        <span class="hist-set-row__value">${valueStr}</span>
        ${markHtml}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Detail event binding
  // ---------------------------------------------------------------------------

  _bindDetailEvents(sessionId) {
    const backBtn   = this.container.querySelector('#hist-back-btn');
    const deleteBtn = this.container.querySelector('#hist-delete-btn');

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this._view            = 'list';
        this._selectedSession = null;
        this._render();
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        this._showDeleteModal(sessionId);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // DELETE MODAL
  // ---------------------------------------------------------------------------

  _showDeleteModal(sessionId) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true"
           aria-labelledby="hist-modal-title">
        <div class="modal__header">
          <h2 class="modal__title" id="hist-modal-title">
            ${t('history.delete_confirm')}
          </h2>
        </div>
        <div class="modal__body">
          <p>${t('history.delete_confirm_sub')}</p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" id="hist-modal-cancel">
            ${t('action.cancel')}
          </button>
          <button class="btn btn--danger" id="hist-modal-delete">
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

    const cancelBtn = overlay.querySelector('#hist-modal-cancel');
    const deleteBtn = overlay.querySelector('#hist-modal-delete');

    cancelBtn.addEventListener('click', closeModal);

    deleteBtn.addEventListener('click', async () => {
      await dbDelete('sessions', sessionId);
      closeModal();

      // Reload and return to list
      await this._loadSessions();
      this._view            = 'list';
      this._selectedSession = null;
      this._render();
    });

    // Close on backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    }, { once: true });
  }
}
