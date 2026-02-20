/**
 * entrainement.js — Page Routines/Entraînement
 *
 * Trois vues internes : list | detail | edit
 * Deux modales : exercise-picker (plein écran) | sets-editor (bottom sheet)
 */

import { t } from '../i18n.js';
import { uid, formatDateShort } from '../utils/helpers.js';
import {
  dbGetAllExercises,
  dbGetAllRoutines,
  dbPutRoutine,
  dbDelete,
} from '../db.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICON_COLORS = [
  '#7c5cbf', '#4caf7d', '#e55353', '#f0a030',
  '#3b9dd4', '#e0609a', '#5bae8f', '#d4873b',
];

function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ICON_COLORS[hash % ICON_COLORS.length];
}

function normalize(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function groupLetter(name) {
  const first = name.trim().charAt(0).toUpperCase();
  return first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() || '#';
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export default class EntrainementPage {
  constructor(container) {
    this.container = container;
    this._view = 'list';          // 'list' | 'detail' | 'edit'
    this._routines = [];
    this._exercises = [];          // non-archived, for picker
    this._selectedRoutine = null;
    this._editRoutine = null;      // deep-cloned routine being edited
    this._pickerSearch = '';
    this._longPressTimer = null;
    this._handlers = {};
    this._page = null;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async render() {
    await this._loadData();
    this.container.innerHTML = '<div class="page" id="wk-page"></div>';
    this._page = this.container.querySelector('#wk-page');
    this._renderList();
    this._bindGlobalListeners();
  }

  destroy() {
    if (this._handlers.docKeydown) {
      document.removeEventListener('keydown', this._handlers.docKeydown);
    }
    this._closeModal();
    clearTimeout(this._longPressTimer);
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  async _loadData() {
    const [routines, exercises] = await Promise.all([
      dbGetAllRoutines(),
      dbGetAllExercises(),
    ]);
    this._exercises = exercises.filter(ex => !ex.isArchived);
    this._routines = routines.sort((a, b) => {
      if (a.lastUsedAt && b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
      if (a.lastUsedAt) return -1;
      if (b.lastUsedAt) return 1;
      return b.createdAt - a.createdAt;
    });
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  _renderList() {
    const routinesHtml = this._routines.length === 0
      ? `<div class="empty-state">
           <i class="fa-solid fa-dumbbell empty-state__icon"></i>
           <p class="empty-state__title">${t('workout.empty')}</p>
           <p class="empty-state__text">${t('workout.empty_sub')}</p>
         </div>`
      : this._routines.map(r => this._buildRoutineCard(r)).join('');

    this._page.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${t('workout.title')}</h1>
        <div class="page-actions">
          <button class="btn btn--icon" data-action="new-routine" aria-label="${t('workout.new_routine')}">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>
      <div class="routine-list" id="wk-routine-list">
        <button class="routine-free-btn" data-action="start-free">
          <i class="fa-solid fa-bolt" style="color:var(--accent);font-size:20px;flex-shrink:0;"></i>
          <div style="flex:1;text-align:left;">
            <div class="routine-free-btn__title">${t('workout.start_empty')}</div>
            <div class="routine-free-btn__sub">${t('workout.free_workout_desc')}</div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color:var(--text-disabled);flex-shrink:0;"></i>
        </button>
        ${routinesHtml}
      </div>`;
  }

  _buildRoutineCard(r) {
    const lastUsed = r.lastUsedAt
      ? t('workout.last_used', { date: formatDateShort(r.lastUsedAt) })
      : t('workout.never_used');
    const exCount = r.exercises ? r.exercises.length : 0;
    const exLabel = t('workout.exercises_count', { n: exCount });

    return `
      <div class="routine-card" data-action="open-routine" data-id="${r.id}">
        <div class="routine-card__name">${escapeHtml(r.name)}</div>
        <div class="routine-card__meta">
          <i class="fa-regular fa-clock routine-card__meta-icon"></i>
          <span>${lastUsed}</span>
          <span class="routine-card__meta-sep">·</span>
          <span>${exLabel}</span>
        </div>
      </div>`;
  }

  _renderDetail(routine) {
    const lastUsed = routine.lastUsedAt
      ? t('workout.last_used', { date: formatDateShort(routine.lastUsedAt) })
      : t('workout.never_used');

    const exercisesHtml = (!routine.exercises || routine.exercises.length === 0)
      ? `<p style="color:var(--text-secondary);font-size:var(--text-sm);padding:var(--space-4) 0;">${t('workout.no_exercises')}</p>`
      : routine.exercises.map(ex => {
          const exercise = this._getExercise(ex.exerciseId);
          if (!exercise) return '';
          const color = colorForId(ex.exerciseId);
          const initial = exercise.name.trim().charAt(0).toUpperCase();
          const setsCount = ex.sets ? ex.sets.length : 0;
          const setsLabel = t('workout.sets_count', { n: setsCount });
          return `
            <div class="routine-detail__exercise-row">
              <div class="routine-detail__exercise-icon" style="background:${color}22;color:${color};">
                ${initial}
              </div>
              <div class="routine-detail__exercise-body">
                <div class="routine-detail__exercise-name">${escapeHtml(exercise.name)}</div>
                <div class="routine-detail__exercise-sets">${setsLabel}</div>
              </div>
            </div>`;
        }).join('');

    this._page.innerHTML = `
      <div class="page-header">
        <button class="btn btn--icon" data-action="back-to-list" aria-label="${t('action.back')}">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <h1 class="page-title">${escapeHtml(routine.name)}</h1>
        <div class="page-actions">
          <button class="btn btn--icon" data-action="open-routine-menu" data-id="${routine.id}" aria-label="Plus">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      </div>
      <div class="routine-detail">
        <p class="routine-detail__subtitle">${lastUsed}</p>
        <div class="routine-detail__exercises">
          ${exercisesHtml}
        </div>
        <div class="routine-start-wrap">
          <button class="routine-start-btn" data-action="start-routine" data-id="${routine.id}">
            ${t('workout.start_btn')}
          </button>
        </div>
      </div>`;
  }

  _renderEdit() {
    const r = this._editRoutine;
    const isNew = !this._routines.find(rt => rt.id === r.id);
    const title = r.name ? escapeHtml(r.name) : t('workout.new_routine');

    this._page.innerHTML = `
      <div class="page-header">
        <button class="btn btn--ghost btn--sm" data-action="cancel-edit">
          ${t('action.cancel')}
        </button>
        <h1 class="page-title" style="font-size:var(--text-base);">${title}</h1>
        <div class="page-actions">
          <button class="btn btn--ghost btn--sm" data-action="save-routine">
            ${t('action.save')}
          </button>
        </div>
      </div>
      <div class="routine-editor">
        <div class="input-group">
          <input
            class="input routine-editor__name-input"
            id="wk-name-input"
            type="text"
            placeholder="${t('workout.routine_name_ph')}"
            value="${escapeHtml(r.name)}"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          >
        </div>
        <div class="routine-editor__section">
          <div class="routine-editor__section-title">${t('exercises.title')}</div>
          <div class="editor-exercise-list" id="wk-exercise-list">
            ${this._buildEditorExerciseList()}
          </div>
          <button class="editor-add-exercise-btn" data-action="open-picker">
            <i class="fa-solid fa-plus"></i>
            ${t('workout.add_exercise')}
          </button>
        </div>
      </div>`;

    // Focus on name input for new routines
    setTimeout(() => {
      const input = document.getElementById('wk-name-input');
      if (input && !r.name) input.focus();
    }, 50);

    // Sync title as user types the routine name
    document.getElementById('wk-name-input')?.addEventListener('input', (e) => {
      this._editRoutine.name = e.target.value;
      const titleEl = this._page.querySelector('.page-title');
      if (titleEl) titleEl.textContent = e.target.value || t('workout.new_routine');
    });
  }

  _buildEditorExerciseList() {
    const exercises = this._editRoutine.exercises || [];
    if (exercises.length === 0) {
      return `<p style="color:var(--text-secondary);font-size:var(--text-sm);padding:var(--space-2) 0;">${t('workout.no_exercises')}</p>`;
    }
    return exercises.map((ex, idx) => {
      const exercise = this._getExercise(ex.exerciseId);
      if (!exercise) return '';
      const color = colorForId(ex.exerciseId);
      const initial = exercise.name.trim().charAt(0).toUpperCase();
      const setsCount = ex.sets ? ex.sets.length : 0;
      const setsLabel = t('workout.sets_count', { n: setsCount });
      return `
        <div class="editor-exercise-item" data-idx="${idx}" data-action="open-sets-editor">
          <div class="editor-exercise-item__icon" style="background:${color}22;color:${color};">
            ${initial}
          </div>
          <div class="editor-exercise-item__body">
            <div class="editor-exercise-item__name">${escapeHtml(exercise.name)}</div>
            <div class="editor-exercise-item__sets">${setsLabel}</div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color:var(--text-disabled);font-size:12px;flex-shrink:0;margin-right:var(--space-1);"></i>
          <button class="btn btn--icon editor-exercise-item__delete" data-action="remove-exercise" data-idx="${idx}" aria-label="${t('action.delete')}">
            <i class="fa-solid fa-trash" style="color:var(--danger);font-size:14px;"></i>
          </button>
        </div>`;
    }).join('');
  }

  _reRenderEditorList() {
    const listEl = document.getElementById('wk-exercise-list');
    if (listEl) listEl.innerHTML = this._buildEditorExerciseList();
  }

  // -------------------------------------------------------------------------
  // Exercise picker modal
  // -------------------------------------------------------------------------

  _openExercisePicker() {
    this._pickerSearch = '';
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    this._renderPickerContent(overlay);

    overlay.onclick = (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;

      if (action === 'close-picker') {
        this._closeModal();
        return;
      }
      if (action === 'pick-exercise') {
        const exId = target.dataset.id;
        if (exId) {
          this._editRoutine.exercises.push({
            exerciseId: exId,
            sets: [{ type: 'normal', reps: 0, weight: 0 }],
            note: '',
          });
          this._closeModal();
          this._reRenderEditorList();
        }
        return;
      }
    };

    // Search input live filter — added once; overlay cleared on close so no leak
    overlay.addEventListener('input', (e) => {
      if (e.target.id === 'wk-picker-search') {
        this._pickerSearch = e.target.value.trim();
        const listEl = document.getElementById('wk-picker-list');
        if (listEl) listEl.innerHTML = this._buildPickerList();
      }
    });

    // Focus search
    setTimeout(() => document.getElementById('wk-picker-search')?.focus(), 50);
  }

  _renderPickerContent(overlay) {
    overlay.innerHTML = `
      <div class="picker-fullscreen">
        <div class="picker-fullscreen__header">
          <button class="btn btn--icon" data-action="close-picker" aria-label="${t('action.close')}">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <span class="picker-fullscreen__title">${t('workout.choose_exercise')}</span>
        </div>
        <div class="picker-fullscreen__search">
          <i class="fa-solid fa-magnifying-glass picker-fullscreen__search-icon"></i>
          <input
            class="picker-fullscreen__search-input"
            id="wk-picker-search"
            type="search"
            placeholder="${t('exercises.search_ph')}"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          >
        </div>
        <div class="picker-fullscreen__list" id="wk-picker-list">
          ${this._buildPickerList()}
        </div>
      </div>`;
  }

  _buildPickerList() {
    let exercises = [...this._exercises];

    if (this._pickerSearch) {
      const q = normalize(this._pickerSearch);
      exercises = exercises.filter(ex => normalize(ex.name).includes(q));
    } else {
      exercises.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    }

    if (exercises.length === 0) {
      return `<div class="empty-state" style="padding:var(--space-8) var(--space-4);">
        <p class="empty-state__title">${t('state.empty')}</p>
      </div>`;
    }

    const buildItem = (ex) => {
      const color = colorForId(ex.id);
      const initial = ex.name.trim().charAt(0).toUpperCase();
      const muscle = ex.muscleGroup ? t(`muscle.${ex.muscleGroup}`) : '';
      return `
        <div class="exercise-item" data-action="pick-exercise" data-id="${ex.id}">
          <div class="exercise-item__icon" style="background:${color}22;color:${color};">
            ${initial}
          </div>
          <div class="exercise-item__body">
            <div class="exercise-item__name">${escapeHtml(ex.name)}</div>
            <div class="exercise-item__meta">${muscle}</div>
          </div>
        </div>`;
    };

    if (this._pickerSearch) {
      return `<div class="exercises-list">
        <div class="exercises-group">
          <div class="exercises-group__items">${exercises.map(buildItem).join('')}</div>
        </div>
      </div>`;
    }

    // Group alphabetically by first letter
    const groups = new Map();
    for (const ex of exercises) {
      const letter = groupLetter(ex.name);
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(ex);
    }

    const groupsHtml = [...groups.entries()].map(([letter, items]) => `
      <div class="exercises-group">
        <div class="exercises-group__letter">${letter}</div>
        <div class="exercises-group__items">${items.map(buildItem).join('')}</div>
      </div>`).join('');

    return `<div class="exercises-list">${groupsHtml}</div>`;
  }

  // -------------------------------------------------------------------------
  // Sets editor modal (bottom sheet)
  // -------------------------------------------------------------------------

  _openSetsEditor(exIdx) {
    const exEntry = this._editRoutine.exercises[exIdx];
    if (!exEntry) return;
    const exercise = this._getExercise(exEntry.exerciseId);
    const exerciseName = exercise ? exercise.name : '?';

    const renderSetsEditor = () => {
      const overlay = document.getElementById('modal-overlay');
      const sets = exEntry.sets || [];

      const typeLabel = (set, si) => {
        if (set.type === 'warmup')  return 'W';
        if (set.type === 'drop')    return 'D';
        if (set.type === 'failure') return 'F';
        if (set.type === 'timer')   return '⏱';
        return String(si + 1);
      };

      const typeClass = (set) => {
        if (set.type === 'warmup')  return 'type-warmup';
        if (set.type === 'drop')    return 'type-drop';
        if (set.type === 'failure') return 'type-failure';
        if (set.type === 'timer')   return 'type-timer';
        return 'type-normal';
      };

      const renderSetRow = (set, si) => {
        if (set.type === 'timer') {
          return `
        <div class="sets-editor__set-row sets-editor__set-row--timer" data-si="${si}">
          <span class="sets-editor__timer-icon"><i class="fa-solid fa-stopwatch"></i></span>
          <input
            class="sets-editor__input input"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            value="${set.duration ?? 90}"
            placeholder="90"
            data-field="duration"
            data-si="${si}"
            style="flex:1;"
          >
          <span class="sets-editor__timer-unit">s</span>
          <button class="btn btn--icon" data-action="remove-set" data-si="${si}" aria-label="${t('action.delete')}">
            <i class="fa-solid fa-xmark" style="color:var(--danger);"></i>
          </button>
        </div>`;
        }
        return `
        <div class="sets-editor__set-row" data-si="${si}">
          <button class="sets-editor__set-type ${typeClass(set)}" data-action="show-set-type-picker" data-si="${si}">
            ${typeLabel(set, si)}
          </button>
          <input
            class="sets-editor__input input"
            type="number"
            min="0"
            step="0.5"
            inputmode="decimal"
            value="${set.weight > 0 ? set.weight : ''}"
            placeholder="—"
            data-field="weight"
            data-si="${si}"
          >
          <input
            class="sets-editor__input input"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            value="${set.reps > 0 ? set.reps : ''}"
            placeholder="—"
            data-field="reps"
            data-si="${si}"
          >
          <button class="btn btn--icon" data-action="remove-set" data-si="${si}" aria-label="${t('action.delete')}">
            <i class="fa-solid fa-xmark" style="color:var(--danger);"></i>
          </button>
        </div>`;
      };
      const setsRows = sets.map((set, si) => renderSetRow(set, si)).join('');

      overlay.innerHTML = `
        <div class="modal sets-editor">
          <div class="modal__handle"></div>
          <div class="sets-editor__header">
            <span class="sets-editor__title">${escapeHtml(exerciseName)}</span>
            <button class="btn btn--icon" data-action="close-sets-editor" aria-label="${t('action.close')}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="sets-editor__body">
            <div class="sets-editor__cols-header">
              <span style="min-width:36px;text-align:center;">${t('session.col_set')}</span>
              <span style="flex:1;text-align:center;">${t('session.col_kg')}</span>
              <span style="flex:1;text-align:center;">${t('session.col_reps')}</span>
              <span style="width:40px;"></span>
            </div>
            <div id="wk-sets-rows">${setsRows}</div>
            <button class="sets-editor__add" data-action="add-set">
              <i class="fa-solid fa-plus"></i>
              ${t('session.add_series')}
            </button>
          </div>
        </div>`;

      overlay.classList.remove('hidden');

      // Assigned fresh each render — replaces stale handler from previous call
      overlay.oninput = (e) => {
        const field = e.target.dataset.field;
        const si = parseInt(e.target.dataset.si);
        if (!field || isNaN(si)) return;
        const val = parseFloat(e.target.value) || 0;
        if (field === 'weight')   exEntry.sets[si].weight   = val;
        if (field === 'reps')     exEntry.sets[si].reps     = val;
        if (field === 'duration') exEntry.sets[si].duration = Math.max(1, Math.round(val)) || 90;
      };

      overlay.onclick = (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) {
          if (e.target === overlay) {
            this._closeModal();
            this._reRenderEditorList();
          }
          return;
        }
        const action = target.dataset.action;
        const si = parseInt(target.dataset.si);

        if (action === 'close-sets-editor') {
          this._closeModal();
          this._reRenderEditorList();
          return;
        }
        if (action === 'add-set') {
          const lastSet = exEntry.sets[exEntry.sets.length - 1];
          exEntry.sets.push({
            type: 'normal',
            reps: lastSet ? lastSet.reps : 0,
            weight: lastSet ? lastSet.weight : 0,
          });
          renderSetsEditor();
          return;
        }
        if (action === 'remove-set' && !isNaN(si)) {
          exEntry.sets.splice(si, 1);
          renderSetsEditor();
          return;
        }
        if (action === 'show-set-type-picker' && !isNaN(si)) {
          _showSetTypePicker(target, si);
          return;
        }
      };
    };

    const _showSetTypePicker = (btn, si) => {
      document.querySelector('.session-type-popup')?.remove();
      const types = [
        { id: 'normal',  label: 'Normal',           abbr: String(si + 1) },
        { id: 'warmup',  label: 'Échauffement',      abbr: 'W' },
        { id: 'drop',    label: 'Série dégressive',  abbr: 'D' },
        { id: 'failure', label: 'Échec',             abbr: 'F' },
      ];
      const popup = document.createElement('div');
      popup.className = 'session-type-popup';
      popup.innerHTML = types.map(tp => `
        <button class="session-type-popup__item" data-type="${tp.id}">
          <span class="session-type-popup__abbr">${escapeHtml(tp.abbr)}</span>
          <span>${escapeHtml(tp.label)}</span>
        </button>`).join('') +
        `<hr class="session-type-popup__divider">
        <button class="session-type-popup__item" data-add-timer="1">
          <span class="session-type-popup__abbr session-type-popup__abbr--timer">
            <i class="fa-solid fa-stopwatch"></i>
          </span>
          <span>Ajouter un minuteur</span>
        </button>`;

      const rect = btn.getBoundingClientRect();
      document.body.appendChild(popup);
      const popupH = popup.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const top = spaceBelow >= popupH ? rect.bottom + 4 : rect.top - popupH - 4;
      popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
      popup.style.top  = `${top}px`;

      // Handle clicks inside the popup directly (it's outside the overlay)
      popup.addEventListener('click', (e) => {
        const item = e.target.closest('[data-type], [data-add-timer]');
        if (!item) return;
        popup.remove();
        if (item.dataset.addTimer) {
          if (exEntry.sets[si + 1]?.type !== 'timer') {
            exEntry.sets.splice(si + 1, 0, { type: 'timer', duration: 90, reps: 0, weight: 0 });
          }
        } else {
          exEntry.sets[si].type = item.dataset.type;
        }
        renderSetsEditor();
      });

      const close = (e) => {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener('pointerdown', close, true);
        }
      };
      setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    };

    renderSetsEditor();
  }

  // -------------------------------------------------------------------------
  // Routine action menu (action sheet)
  // -------------------------------------------------------------------------

  _openRoutineMenu(id) {
    const routine = this._routines.find(r => r.id === id);
    if (!routine) return;

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="action-sheet">
        <div class="action-sheet__title">${escapeHtml(routine.name)}</div>
        <div class="action-sheet__item" data-action="edit-routine" data-id="${id}">
          <i class="fa-solid fa-pen"></i>
          ${t('workout.edit_routine')}
        </div>
        <div class="action-sheet__item" data-action="duplicate-routine" data-id="${id}">
          <i class="fa-solid fa-copy"></i>
          ${t('workout.duplicate_routine')}
        </div>
        <div class="action-sheet__item action-sheet__item--danger" data-action="confirm-delete-routine" data-id="${id}">
          <i class="fa-solid fa-trash"></i>
          ${t('workout.delete_routine')}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = async (e) => {
      if (e.target === overlay) { this._closeModal(); return; }
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const rid = target.dataset.id;

      if (action === 'edit-routine') {
        this._closeModal();
        this._showEdit(this._routines.find(r => r.id === rid));
        return;
      }
      if (action === 'duplicate-routine') {
        await this._duplicateRoutine(rid);
        return;
      }
      if (action === 'confirm-delete-routine') {
        overlay.innerHTML = `
          <div class="action-sheet">
            <div class="action-sheet__title">${t('workout.delete_confirm')}</div>
            <p style="padding:var(--space-3) var(--space-4);color:var(--text-secondary);font-size:var(--text-sm);">${t('workout.delete_confirm_sub')}</p>
            <div class="action-sheet__item action-sheet__item--danger" data-action="delete-routine" data-id="${rid}">
              <i class="fa-solid fa-trash"></i>
              ${t('action.delete')}
            </div>
            <div class="action-sheet__item" data-action="close-sheet">
              <i class="fa-solid fa-xmark"></i>
              ${t('action.cancel')}
            </div>
          </div>`;
        return;
      }
      if (action === 'delete-routine') {
        await this._deleteRoutine(rid);
        return;
      }
      if (action === 'close-sheet') {
        this._closeModal();
        return;
      }
    };
  }

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  _showList() {
    this._view = 'list';
    this._selectedRoutine = null;
    this._renderList();
  }

  _showDetail(routine) {
    this._view = 'detail';
    this._selectedRoutine = routine;
    this._renderDetail(routine);
  }

  _showEdit(routine = null) {
    this._view = 'edit';
    // Note: _selectedRoutine is intentionally NOT cleared here so that
    // cancel-edit can navigate back to detail when editing an existing routine.
    this._editRoutine = routine
      ? JSON.parse(JSON.stringify(routine))
      : { id: uid(), name: '', exercises: [], createdAt: Date.now(), updatedAt: Date.now(), lastUsedAt: null };
    this._renderEdit();
  }

  // -------------------------------------------------------------------------
  // CRUD helpers
  // -------------------------------------------------------------------------

  async _saveRoutine() {
    const nameInput = document.getElementById('wk-name-input');
    const name = nameInput ? nameInput.value.trim() : this._editRoutine.name.trim();
    if (!name) {
      if (nameInput) {
        nameInput.style.borderBottomColor = 'var(--danger)';
        nameInput.focus();
      }
      return;
    }
    this._editRoutine.name = name;
    this._editRoutine.updatedAt = Date.now();
    await dbPutRoutine(this._editRoutine);
    const idx = this._routines.findIndex(r => r.id === this._editRoutine.id);
    if (idx >= 0) this._routines[idx] = { ...this._editRoutine };
    else this._routines.unshift({ ...this._editRoutine });
    this._showList();
  }

  async _deleteRoutine(id) {
    await dbDelete('routines', id);
    this._routines = this._routines.filter(r => r.id !== id);
    this._closeModal();
    if (this._view === 'detail' && this._selectedRoutine?.id === id) {
      this._showList();
    } else {
      this._renderList();
    }
  }

  async _duplicateRoutine(id) {
    const original = this._routines.find(r => r.id === id);
    if (!original) return;
    const copy = {
      ...JSON.parse(JSON.stringify(original)),
      id: uid(),
      name: original.name + ' (copie)',
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await dbPutRoutine(copy);
    this._routines.unshift(copy);
    this._closeModal();
    this._renderList();
  }

  _closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      overlay.onclick = null;
      overlay.oninput = null;
    }
  }

  _getExercise(id) {
    return this._exercises.find(ex => ex.id === id);
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  _bindGlobalListeners() {
    // ESC closes any open modal
    this._handlers.docKeydown = (e) => {
      if (e.key === 'Escape') this._closeModal();
    };
    document.addEventListener('keydown', this._handlers.docKeydown);

    // Delegated click handler on the page container
    this._page.addEventListener('click', e => this._onPageClick(e));

    // Long-press on routine cards opens the action menu
    this._page.addEventListener('pointerdown',  e  => this._onPointerDown(e));
    this._page.addEventListener('pointerup',    ()  => clearTimeout(this._longPressTimer));
    this._page.addEventListener('pointercancel',()  => clearTimeout(this._longPressTimer));
    this._page.addEventListener('pointermove',  ()  => clearTimeout(this._longPressTimer));
  }

  _onPointerDown(e) {
    const card = e.target.closest('.routine-card');
    if (!card) return;
    this._longPressTimer = setTimeout(() => {
      this._openRoutineMenu(card.dataset.id);
    }, 500);
  }

  _onPageClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
      case 'new-routine':
        this._showEdit(null);
        break;

      case 'open-routine': {
        const routine = this._routines.find(r => r.id === target.dataset.id);
        if (routine) this._showDetail(routine);
        break;
      }

      case 'back-to-list':
        this._showList();
        break;

      case 'cancel-edit':
        // _showEdit does NOT clear _selectedRoutine, so if the user arrived here
        // via the detail-view menu, _selectedRoutine is still populated.
        if (this._selectedRoutine) {
          this._showDetail(this._selectedRoutine);
        } else {
          this._showList();
        }
        break;

      case 'save-routine':
        this._saveRoutine();
        break;

      case 'open-picker':
        this._openExercisePicker();
        break;

      case 'open-sets-editor': {
        e.stopPropagation();
        const idx = parseInt(target.dataset.idx);
        if (!isNaN(idx)) this._openSetsEditor(idx);
        break;
      }

      case 'remove-exercise': {
        e.stopPropagation();
        const idx = parseInt(target.dataset.idx);
        if (!isNaN(idx)) {
          this._editRoutine.exercises.splice(idx, 1);
          this._reRenderEditorList();
        }
        break;
      }

      case 'open-routine-menu':
        this._openRoutineMenu(target.dataset.id);
        break;

      case 'start-routine':
        this.container.dispatchEvent(
          new CustomEvent('start-session', {
            bubbles: true,
            detail: { routineId: target.dataset.id },
          })
        );
        break;

      case 'start-free':
        this.container.dispatchEvent(
          new CustomEvent('start-session', {
            bubbles: true,
            detail: { routineId: null },
          })
        );
        break;
    }
  }
}
