// =============================================================================
// js/pages/profil.js — Profile + Dashboard + Settings page
// Gros Monsieur PWA
// =============================================================================

import { t } from '../i18n.js';
import {
  uid,
  formatDuration,
  formatWeight,
  formatMonthYear,
  groupBy,
  getLast8Weeks,
  startOfWeek,
  isSameDay,
} from '../utils/helpers.js';
import {
  dbGetProfile,
  dbSaveProfile,
  dbGetAllSessions,
  dbGetAllMeasurements,
  dbGetAllExercises,
} from '../db.js';
import { setTheme } from '../app.js';
import { exportData, importData } from '../utils/export.js';

// =============================================================================
// Local helpers
// =============================================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Default profile skeleton (in case initDB hasn't run yet). */
function _defaultProfile() {
  return {
    id: 'singleton',
    name: 'Utilisateur',
    avatarInitials: 'U',
    totalWorkouts: 0,
    theme: 'dark',
    settings: {
      soundEffects: true,
      lockCompletedSets: false,
      confirmDeleteSet: true,
      previousSets: 'same_routine',
      manageIncompleteSets: 'ask',
      availableBars: [
        { name: 'Olympique', weight: 20 },
        { name: 'EZ', weight: 10 },
      ],
      availablePlates: [
        { weight: 25,   count: 4 },
        { weight: 20,   count: 4 },
        { weight: 15,   count: 4 },
        { weight: 10,   count: 4 },
        { weight: 5,    count: 4 },
        { weight: 2.5,  count: 4 },
        { weight: 1.25, count: 4 },
      ],
      restTimer: { simpleTimers: false, defaultSeconds: 90 },
    },
    dashboardWidgets: [{ id: 'weekly_workouts', config: {} }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** All available widget definitions. */
const WIDGET_CATALOG = [
  {
    id: 'weekly_workouts',
    icon: 'fa-solid fa-dumbbell',
    titleKey: 'widget.weekly_workouts',
    descKey: 'widget.weekly_workouts_desc',
    needsConfig: false,
  },
  {
    id: 'exercise_progress',
    icon: 'fa-solid fa-chart-line',
    titleKey: 'widget.exercise_progress',
    descKey: 'widget.exercise_progress_desc',
    needsConfig: true,
    configType: 'exercise',
  },
  {
    id: 'weekly_calories',
    icon: 'fa-solid fa-fire',
    titleKey: 'widget.weekly_calories',
    descKey: 'widget.weekly_calories_desc',
    needsConfig: false,
  },
  {
    id: 'daily_macros',
    icon: 'fa-solid fa-apple-whole',
    titleKey: 'widget.daily_macros',
    descKey: 'widget.daily_macros_desc',
    needsConfig: false,
  },
  {
    id: 'measure',
    icon: 'fa-solid fa-ruler-horizontal',
    titleKey: 'widget.measure',
    descKey: 'widget.measure_desc',
    needsConfig: true,
    configType: 'measureType',
  },
];

// Known measurement types (extend as needed)
const MEASURE_TYPES = [
  'poids', 'tour_de_taille', 'tour_de_poitrine', 'tour_de_bras',
  'tour_de_cuisses', 'tour_de_mollets', 'tour_de_hanches',
  'masse_grasse', 'masse_musculaire', 'calories',
];

// =============================================================================
// ProfilPage
// =============================================================================

export default class ProfilPage {
  constructor(container) {
    this.container = container;

    // ── State ──────────────────────────────────────────────
    this._view         = 'dashboard'; // 'dashboard' | 'settings'
    this._profile      = null;
    this._sessions     = [];
    this._measurements = [];
    this._exercises    = [];

    // Settings sub-view
    this._settingsEditingProfile = false;

    // Document-level listeners removed in destroy()
    this._handlers = {};
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  async render() {
    const [profile, sessions, measurements, exercises] = await Promise.all([
      dbGetProfile(),
      dbGetAllSessions(),
      dbGetAllMeasurements(),
      dbGetAllExercises(),
    ]);

    this._profile      = profile ?? _defaultProfile();
    this._sessions     = sessions;
    this._measurements = measurements;
    this._exercises    = exercises;

    // Ensure required nested objects exist (defensive)
    if (!this._profile.settings) this._profile.settings = _defaultProfile().settings;
    if (!Array.isArray(this._profile.dashboardWidgets)) this._profile.dashboardWidgets = [];

    this._render();
  }

  destroy() {
    for (const [event, handler] of Object.entries(this._handlers)) {
      document.removeEventListener(event, handler);
    }
    this._handlers = {};
  }

  // ===========================================================================
  // Internal routing
  // ===========================================================================

  _render() {
    if (this._view === 'settings') {
      this._renderSettings();
    } else {
      this._view = 'dashboard';
      this._renderDashboard();
    }
  }

  // ===========================================================================
  // DASHBOARD VIEW
  // ===========================================================================

  _renderDashboard() {
    const p       = this._profile;
    const initials = escapeHtml(p.avatarInitials || p.name?.charAt(0).toUpperCase() || '?');
    const name     = escapeHtml(p.name || '');
    const count    = this._sessions.length;
    const countLabel = t('profile.workouts_count').replace('{n}', count);

    const widgetsHtml = this._renderWidgets();

    const emptyDash = p.dashboardWidgets.length === 0
      ? `<div class="dashboard__empty">
           <p class="empty-state__title">${t('profile.no_widgets')}</p>
           <p class="empty-state__text">${t('profile.no_widgets_sub')}</p>
         </div>`
      : '';

    this.container.innerHTML = `
      <div class="page">

        <!-- Page header -->
        <div class="page-header">
          <h1 class="page-title">${t('profile.title')}</h1>
          <div class="page-actions">
            <button class="icon-btn" data-action="open-settings" aria-label="${t('profile.settings')}">
              <i class="fa-solid fa-gear"></i>
            </button>
          </div>
        </div>

        <!-- Profile header card -->
        <div class="profile-header">
          <div class="profile-avatar" aria-hidden="true">${initials}</div>
          <div class="profile-info">
            <p class="profile-name">${name}</p>
            <p class="profile-workouts">
              <i class="fa-solid fa-trophy"></i>
              ${escapeHtml(countLabel)}
            </p>
          </div>
        </div>

        <!-- Dashboard section -->
        <div class="dashboard">
          <div class="dashboard__header">
            <h2 class="dashboard__title">${t('profile.dashboard')}</h2>
            <button class="icon-btn dashboard__add-btn" data-action="add-widget"
                    aria-label="${t('profile.add_widget')}">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>

          ${emptyDash}

          <div class="dashboard__list">
            ${widgetsHtml}
          </div>
        </div>

      </div>`;

    this._bindDashboardEvents();
  }

  // ---------------------------------------------------------------------------
  // Widget rendering
  // ---------------------------------------------------------------------------

  _renderWidgets() {
    return this._profile.dashboardWidgets
      .map(widget => this._renderWidget(widget))
      .join('');
  }

  _renderWidget(widget) {
    const def = WIDGET_CATALOG.find(d => d.id === widget.id);
    if (!def) return '';

    const title  = t(def.titleKey);
    const icon   = def.icon;
    const body   = this._renderWidgetBody(widget, def);

    return `
      <div class="widget-card" data-widget-id="${escapeHtml(widget.id)}">
        <div class="widget-card__header">
          <span class="widget-card__icon"><i class="${escapeHtml(icon)}"></i></span>
          <span class="widget-card__title">${escapeHtml(title)}</span>
          <button class="widget-card__remove icon-btn"
                  data-action="remove-widget"
                  data-widget-id="${escapeHtml(widget.id)}"
                  aria-label="${t('action.close')}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="widget-card__body">
          ${body}
        </div>
      </div>`;
  }

  _renderWidgetBody(widget, def) {
    switch (widget.id) {
      case 'weekly_workouts':   return this._bodyWeeklyWorkouts();
      case 'exercise_progress': return this._bodyExerciseProgress(widget.config);
      case 'weekly_calories':   return this._bodyWeeklyCalories();
      case 'daily_macros':      return this._bodyDailyMacros();
      case 'measure':           return this._bodyMeasure(widget.config);
      default:                  return `<p class="widget-stat">${t('widget.no_data')}</p>`;
    }
  }

  // ── weekly_workouts ────────────────────────────────────────────────────────

  _bodyWeeklyWorkouts() {
    const weeks        = getLast8Weeks(); // 8 timestamps (monday 00:00)
    const DAY_MS       = 7 * 24 * 60 * 60 * 1000;
    const currentWeekStart = startOfWeek(Date.now());

    // Count sessions per week
    const counts = weeks.map(weekStart => {
      const weekEnd = weekStart + DAY_MS;
      return this._sessions.filter(
        s => s.startTime >= weekStart && s.startTime < weekEnd
      ).length;
    });

    const max = Math.max(...counts, 1); // avoid div by 0

    // Current week count (last element)
    const currentCount = counts[counts.length - 1];
    const currentLabel = t('widget.workouts_this_week').replace('{n}', currentCount);

    const barsHtml = weeks.map((weekStart, i) => {
      const isCurrent = weekStart === currentWeekStart;
      const heightPx  = Math.max(4, Math.round((counts[i] / max) * 56));
      const date      = new Date(weekStart);
      // Label: show day/month (e.g. "03/02")
      const label     = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;

      return `
        <div class="widget-bar${isCurrent ? ' widget-bar--current' : ''}">
          <div class="widget-bar__fill" style="height:${heightPx}px"></div>
          <span class="widget-bar__label">${escapeHtml(label)}</span>
        </div>`;
    }).join('');

    return `
      <div class="widget-bars">${barsHtml}</div>
      <div class="widget-stat">
        <span class="widget-stat__label">${escapeHtml(currentLabel)}</span>
      </div>`;
  }

  // ── exercise_progress ──────────────────────────────────────────────────────

  _bodyExerciseProgress(config) {
    const exerciseId = config?.exerciseId;
    if (!exerciseId) {
      return `
        <div class="widget-stat">
          <span class="widget-stat__label">${t('widget.no_data')}</span>
        </div>`;
    }

    const exercise = this._exercises.find(e => e.id === exerciseId);
    const name     = exercise ? escapeHtml(exercise.name) : escapeHtml(exerciseId);

    // Collect best sets for this exercise across sessions (most recent 3)
    const sessionsWithEx = this._sessions
      .filter(s => Array.isArray(s.exercises) && s.exercises.some(e => e.exerciseId === exerciseId))
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 3);

    if (sessionsWithEx.length === 0) {
      return `
        <div class="widget-progress__exercise">${name}</div>
        <div class="widget-stat">
          <span class="widget-stat__label">${t('widget.no_data')}</span>
        </div>`;
    }

    const rowsHtml = sessionsWithEx.map(session => {
      const exEntry  = session.exercises.find(e => e.exerciseId === exerciseId);
      const bestSet  = exEntry?.bestSet;
      const dateStr  = new Date(session.startTime).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit',
      });
      const bestStr  = bestSet
        ? `${bestSet.weight} kg × ${bestSet.reps}`
        : '—';

      return `
        <div class="widget-progress__best">
          <span>${escapeHtml(dateStr)}</span>
          <span>${escapeHtml(bestStr)}</span>
        </div>`;
    }).join('');

    return `
      <div class="widget-progress__exercise">${name}</div>
      ${rowsHtml}`;
  }

  // ── weekly_calories ────────────────────────────────────────────────────────

  _bodyWeeklyCalories() {
    const weekStart = startOfWeek(Date.now());
    const total     = this._measurements
      .filter(m => m.type === 'calories' && m.date >= weekStart)
      .reduce((sum, m) => sum + (Number(m.value) || 0), 0);

    return `
      <div class="widget-stat">
        <span class="widget-stat__value">${total.toLocaleString('fr-FR')}</span>
        <span class="widget-stat__unit">kcal</span>
        <span class="widget-stat__label">${t('widget.weekly_calories')}</span>
      </div>`;
  }

  // ── daily_macros ───────────────────────────────────────────────────────────

  _bodyDailyMacros() {
    const now   = Date.now();
    const today = this._measurements
      .filter(m => m.type === 'calories' && isSameDay(m.date, now))
      .reduce((sum, m) => sum + (Number(m.value) || 0), 0);

    return `
      <div class="widget-stat">
        <span class="widget-stat__value">${today.toLocaleString('fr-FR')}</span>
        <span class="widget-stat__unit">kcal</span>
        <span class="widget-stat__label">${t('widget.daily_macros')}</span>
      </div>`;
  }

  // ── measure ────────────────────────────────────────────────────────────────

  _bodyMeasure(config) {
    const measureType = config?.measureType;
    if (!measureType) {
      return `
        <div class="widget-stat">
          <span class="widget-stat__label">${t('widget.no_data')}</span>
        </div>`;
    }

    const latest = this._measurements
      .filter(m => m.type === measureType)
      .sort((a, b) => b.date - a.date)[0];

    if (!latest) {
      return `
        <div class="widget-stat">
          <span class="widget-stat__label">${escapeHtml(measureType)}</span>
          <span class="widget-stat__sub">${t('widget.no_data')}</span>
        </div>`;
    }

    return `
      <div class="widget-stat">
        <span class="widget-stat__value">${escapeHtml(String(latest.value))}</span>
        <span class="widget-stat__unit">${escapeHtml(latest.unit || '')}</span>
        <span class="widget-stat__label">${escapeHtml(measureType)}</span>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Dashboard event binding
  // ---------------------------------------------------------------------------

  _bindDashboardEvents() {
    this.container.addEventListener('click', this._onDashboardClick = (e) => {
      // Settings button
      if (e.target.closest('[data-action="open-settings"]')) {
        this._view = 'settings';
        this._settingsEditingProfile = false;
        this._render();
        return;
      }

      // Add widget
      if (e.target.closest('[data-action="add-widget"]')) {
        this._openWidgetPicker();
        return;
      }

      // Remove widget
      const removeBtn = e.target.closest('[data-action="remove-widget"]');
      if (removeBtn) {
        const widgetId = removeBtn.dataset.widgetId;
        this._removeWidget(widgetId);
        return;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Widget management
  // ---------------------------------------------------------------------------

  async _removeWidget(widgetId) {
    this._profile.dashboardWidgets = this._profile.dashboardWidgets
      .filter(w => w.id !== widgetId);
    await dbSaveProfile(this._profile).catch(console.error);
    this._renderDashboard();
  }

  async _addWidget(widgetId, config = {}) {
    this._profile.dashboardWidgets.push({ id: widgetId, config });
    await dbSaveProfile(this._profile).catch(console.error);
    this._renderDashboard();
  }

  // ---------------------------------------------------------------------------
  // Widget picker modal
  // ---------------------------------------------------------------------------

  _openWidgetPicker() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    const itemsHtml = WIDGET_CATALOG.map(def => `
      <button class="widget-picker__item" data-widget-def-id="${escapeHtml(def.id)}">
        <span class="widget-card__icon"><i class="${escapeHtml(def.icon)}"></i></span>
        <div>
          <strong>${escapeHtml(t(def.titleKey))}</strong>
          <p>${escapeHtml(t(def.descKey))}</p>
        </div>
      </button>`).join('');

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="picker-modal-title">
        <div class="modal__header">
          <h2 class="modal__title" id="picker-modal-title">${t('profile.add_widget')}</h2>
          <button class="icon-btn" data-action="close-modal" aria-label="${t('action.close')}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="modal__body">
          <div class="widget-picker__list">
            ${itemsHtml}
          </div>
        </div>
      </div>`;

    overlay.classList.remove('hidden');

    const closeModal = () => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    };

    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay || e.target.closest('[data-action="close-modal"]')) {
        closeModal();
        return;
      }

      const item = e.target.closest('.widget-picker__item');
      if (!item) return;

      const defId = item.dataset.widgetDefId;
      const def   = WIDGET_CATALOG.find(d => d.id === defId);
      if (!def) return;

      if (def.needsConfig) {
        this._renderWidgetConfigStep(overlay, def, closeModal);
      } else {
        closeModal();
        await this._addWidget(defId, {});
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Widget config step (inside the modal after picking a widget)
  // ---------------------------------------------------------------------------

  _renderWidgetConfigStep(overlay, def, closeModal) {
    let listHtml = '';

    if (def.configType === 'exercise') {
      if (this._exercises.length === 0) {
        listHtml = `<p>${t('widget.no_data')}</p>`;
      } else {
        listHtml = this._exercises
          .filter(ex => !ex.isArchived)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(ex => `
            <button class="widget-picker__item" data-config-value="${escapeHtml(ex.id)}">
              ${escapeHtml(ex.name)}
            </button>`).join('');
      }
    } else if (def.configType === 'measureType') {
      // Build list from known types + any used in measurements
      const usedTypes = [...new Set(this._measurements.map(m => m.type))];
      const allTypes  = [...new Set([...MEASURE_TYPES, ...usedTypes])].sort();

      listHtml = allTypes.map(type => `
        <button class="widget-picker__item" data-config-value="${escapeHtml(type)}">
          ${escapeHtml(type)}
        </button>`).join('');
    }

    overlay.querySelector('.modal__body').innerHTML = `
      <div class="widget-picker__list">
        ${listHtml}
      </div>`;

    // Update header to reflect the sub-step
    overlay.querySelector('.modal__title').textContent = t(def.titleKey);

    // Remove old listeners via clone trick
    const body = overlay.querySelector('.modal__body');
    const freshBody = body.cloneNode(true);
    body.parentNode.replaceChild(freshBody, body);

    freshBody.addEventListener('click', async (e) => {
      const item = e.target.closest('.widget-picker__item');
      if (!item) return;

      const value = item.dataset.configValue;
      closeModal();

      const config = def.configType === 'exercise'
        ? { exerciseId: value }
        : { measureType: value };

      await this._addWidget(def.id, config);
    });
  }

  // ===========================================================================
  // SETTINGS VIEW
  // ===========================================================================

  _renderSettings() {
    const p   = this._profile;
    const s   = p.settings;
    const loc = localStorage.getItem('gm-locale') || 'fr';

    this.container.innerHTML = `
      <div class="page">

        <!-- Settings header -->
        <div class="page-header">
          <button class="icon-btn" data-action="settings-back" aria-label="${t('action.back')}">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <h1 class="page-title">${t('settings.title')}</h1>
        </div>

        <!-- Section: Profile -->
        <section class="settings-section">
          <h2 class="settings-section__title">${t('settings.profile')}</h2>
          ${this._settingsEditingProfile
            ? this._renderProfileEditForm()
            : this._renderProfileRow()}
        </section>

        <!-- Section: Appearance -->
        <section class="settings-section">
          <h2 class="settings-section__title">${t('settings.appearance')}</h2>

          <!-- Theme -->
          <div class="settings-row">
            <label class="settings-row__label">${t('settings.theme')}</label>
            <div class="settings-row__control">
              <select class="settings-select" data-setting="theme">
                <option value="dark"  ${p.theme === 'dark'  ? 'selected' : ''}>${t('settings.theme_dark')}</option>
                <option value="light" ${p.theme === 'light' ? 'selected' : ''}>${t('settings.theme_light')}</option>
                <option value="auto"  ${p.theme === 'auto'  ? 'selected' : ''}>${t('settings.theme_auto')}</option>
              </select>
            </div>
          </div>

          <!-- Language -->
          <div class="settings-row">
            <label class="settings-row__label">${t('settings.language')}</label>
            <div class="settings-row__control">
              <select class="settings-select" data-setting="language">
                <option value="fr" ${loc === 'fr' ? 'selected' : ''}>Français</option>
                <option value="en" ${loc === 'en' ? 'selected' : ''}>English</option>
              </select>
            </div>
          </div>
        </section>

        <!-- Section: Workout -->
        <section class="settings-section">
          <h2 class="settings-section__title">${t('settings.workout')}</h2>

          <!-- Sound effects -->
          ${this._toggleRow('soundEffects', s.soundEffects, 'settings.sound', 'settings.sound_desc')}

          <!-- Lock completed sets -->
          ${this._toggleRow('lockCompletedSets', s.lockCompletedSets, 'settings.lock_sets')}

          <!-- Confirm delete set -->
          ${this._toggleRow('confirmDeleteSet', s.confirmDeleteSet, 'settings.confirm_delete_set')}

          <!-- Previous sets -->
          <div class="settings-row">
            <label class="settings-row__label">${t('settings.prev_sets')}</label>
            <div class="settings-row__control">
              <select class="settings-select" data-setting="previousSets">
                <option value="same_routine" ${s.previousSets === 'same_routine' ? 'selected' : ''}>
                  ${t('settings.prev_sets_same')}
                </option>
                <option value="any" ${s.previousSets === 'any' ? 'selected' : ''}>
                  ${t('settings.prev_sets_any')}
                </option>
              </select>
            </div>
          </div>

          <!-- Manage incomplete sets -->
          <div class="settings-row">
            <label class="settings-row__label">${t('settings.incomplete_sets')}</label>
            <div class="settings-row__control">
              <select class="settings-select" data-setting="manageIncompleteSets">
                <option value="ask"    ${s.manageIncompleteSets === 'ask'    ? 'selected' : ''}>
                  ${t('settings.incomplete_ask')}
                </option>
                <option value="keep"   ${s.manageIncompleteSets === 'keep'   ? 'selected' : ''}>
                  ${t('settings.incomplete_keep')}
                </option>
                <option value="delete" ${s.manageIncompleteSets === 'delete' ? 'selected' : ''}>
                  ${t('settings.incomplete_delete')}
                </option>
              </select>
            </div>
          </div>
        </section>

        <!-- Section: Data -->
        <section class="settings-section">
          <h2 class="settings-section__title">${t('settings.data')}</h2>

          <div class="settings-row">
            <button class="btn btn--ghost" data-action="export-data">
              <i class="fa-solid fa-file-export"></i>
              ${t('settings.export_data')}
            </button>
          </div>

          <div class="settings-row">
            <button class="btn btn--ghost" data-action="import-data">
              <i class="fa-solid fa-file-import"></i>
              ${t('settings.import_data')}
            </button>
            <p class="settings-row__sub">${t('settings.import_warning')}</p>
          </div>
        </section>

      </div>`;

    this._bindSettingsEvents();
  }

  // ---------------------------------------------------------------------------
  // Profile display row (read-only)
  // ---------------------------------------------------------------------------

  _renderProfileRow() {
    const p = this._profile;
    return `
      <div class="settings-row settings-profile-edit">
        <div class="settings-row__label">
          <div class="profile-avatar profile-avatar--small" aria-hidden="true">
            ${escapeHtml(p.avatarInitials || '?')}
          </div>
          <span>${escapeHtml(p.name || '')}</span>
        </div>
        <div class="settings-row__control">
          <button class="btn btn--ghost" data-action="edit-profile">
            ${t('settings.profile_edit')}
          </button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Profile edit form (inline)
  // ---------------------------------------------------------------------------

  _renderProfileEditForm() {
    const p = this._profile;
    return `
      <div class="form-group">
        <label class="form-label" for="profile-name-input">${t('settings.profile')}</label>
        <input class="form-input" id="profile-name-input" type="text"
               value="${escapeHtml(p.name || '')}"
               placeholder="Votre nom"
               maxlength="40" />
      </div>
      <div class="form-group">
        <label class="form-label" for="profile-initials-input">Initiales</label>
        <input class="form-input" id="profile-initials-input" type="text"
               value="${escapeHtml(p.avatarInitials || '')}"
               placeholder="AB"
               maxlength="3" />
      </div>
      <div class="settings-row" style="gap: 0.5rem; margin-top: 0.75rem;">
        <button class="btn btn--primary" data-action="save-profile">
          ${t('action.save')}
        </button>
        <button class="btn btn--ghost" data-action="cancel-profile-edit">
          ${t('action.back')}
        </button>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Toggle row helper
  // ---------------------------------------------------------------------------

  _toggleRow(settingKey, value, labelKey, subKey = null) {
    const subHtml = subKey
      ? `<span class="settings-row__sub">${t(subKey)}</span>`
      : '';

    return `
      <div class="settings-row">
        <div class="settings-row__label">
          ${t(labelKey)}
          ${subHtml}
        </div>
        <div class="settings-row__control">
          <label class="settings-toggle">
            <input class="settings-toggle__input" type="checkbox"
                   data-setting="${escapeHtml(settingKey)}"
                   ${value ? 'checked' : ''} />
            <span class="settings-toggle__slider"></span>
          </label>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Settings events (all delegated)
  // ---------------------------------------------------------------------------

  _bindSettingsEvents() {
    this.container.addEventListener('click',  this._onSettingsClick  = (e) => this._handleSettingsClick(e));
    this.container.addEventListener('change', this._onSettingsChange = (e) => this._handleSettingsChange(e));
  }

  _handleSettingsClick(e) {
    // Back to dashboard
    if (e.target.closest('[data-action="settings-back"]')) {
      this._view = 'dashboard';
      this._renderDashboard();
      return;
    }

    // Edit profile
    if (e.target.closest('[data-action="edit-profile"]')) {
      this._settingsEditingProfile = true;
      this._renderSettings();
      return;
    }

    // Save profile edits
    if (e.target.closest('[data-action="save-profile"]')) {
      const nameInput     = this.container.querySelector('#profile-name-input');
      const initialsInput = this.container.querySelector('#profile-initials-input');
      const newName       = nameInput?.value.trim() || this._profile.name;
      const newInitials   = initialsInput?.value.trim().toUpperCase().slice(0, 3) ||
                            newName.charAt(0).toUpperCase();

      this._profile.name           = newName;
      this._profile.avatarInitials = newInitials;
      this._profile.updatedAt      = Date.now();
      dbSaveProfile(this._profile).catch(console.error);

      this._settingsEditingProfile = false;
      this._renderSettings();
      return;
    }

    // Cancel profile edit
    if (e.target.closest('[data-action="cancel-profile-edit"]')) {
      this._settingsEditingProfile = false;
      this._renderSettings();
      return;
    }

    // Export data
    if (e.target.closest('[data-action="export-data"]')) {
      exportData().catch(err => {
        console.error('[profil] Export error:', err);
        alert(`Erreur lors de l'export : ${err.message}`);
      });
      return;
    }

    // Import data
    if (e.target.closest('[data-action="import-data"]')) {
      importData().then(result => {
        if (result.success) {
          alert(result.message);
          // Reload page data after successful import
          this.render();
        } else if (result.message && result.message !== 'Aucun fichier sélectionné.' && result.message !== "Import annulé par l'utilisateur.") {
          alert(result.message);
        }
      }).catch(err => {
        console.error('[profil] Import error:', err);
        alert(`Erreur lors de l'import : ${err.message}`);
      });
      return;
    }
  }

  _handleSettingsChange(e) {
    const target      = e.target;
    const settingKey  = target.dataset.setting;
    if (!settingKey) return;

    // ── Theme ──────────────────────────────────────────────
    if (settingKey === 'theme') {
      const value = target.value; // 'dark' | 'light' | 'auto'
      this._profile.theme       = value;
      this._profile.updatedAt   = Date.now();
      setTheme(value);
      dbSaveProfile(this._profile).catch(console.error);
      return;
    }

    // ── Language ───────────────────────────────────────────
    if (settingKey === 'language') {
      const lang = target.value;
      localStorage.setItem('gm-locale', lang);
      // Reload to reinitialise i18n
      window.location.reload();
      return;
    }

    // ── Boolean toggles (checkboxes) ───────────────────────
    if (target.type === 'checkbox') {
      const boolKeys = ['soundEffects', 'lockCompletedSets', 'confirmDeleteSet'];
      if (boolKeys.includes(settingKey)) {
        this._profile.settings[settingKey] = target.checked;
        this._profile.updatedAt            = Date.now();
        dbSaveProfile(this._profile).catch(console.error);
        return;
      }
    }

    // ── Select-based settings ──────────────────────────────
    const selectKeys = ['previousSets', 'manageIncompleteSets'];
    if (selectKeys.includes(settingKey)) {
      this._profile.settings[settingKey] = target.value;
      this._profile.updatedAt            = Date.now();
      dbSaveProfile(this._profile).catch(console.error);
      return;
    }
  }
}
