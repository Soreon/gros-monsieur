import { t } from '../i18n.js';
import { uid, formatDuration, formatDateShort } from '../utils/helpers.js';
import {
  dbGetAllExercises,
  dbGetAllSessions,
  dbGetAllRoutines,
  dbPutRoutine,
  dbPutSession,
  dbPutExercise,
  dbGetProfile,
  dbSaveProfile,
} from '../db.js';
import { setState, getState } from '../store.js';

const ICON_COLORS = ['#7c5cbf','#4caf7d','#e55353','#f0a030','#3b9dd4','#e0609a','#5bae8f','#d4873b'];

function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ICON_COLORS[hash % ICON_COLORS.length];
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export default class SessionOverlay {
  constructor() {
    this._overlay   = document.getElementById('session-overlay');
    this._bar       = document.getElementById('session-bar');
    this._session   = null;        // active session object
    this._exercises = [];          // all non-archived exercises
    this._elapsed   = 0;          // seconds since session start
    this._minimized = false;
    this._prevSets  = {};          // {exerciseId: [{weight,reps,type}]}
    this._prHistory = {};          // {exerciseId: maxEstimated1RM}
    this._timerInterval = null;
    this._handlers  = {};

    // Rest timer state
    this._restDuration  = 90;  // seconds, overridden from profile on session start
    this._restRemaining = 0;
    this._restTotal     = 0;
    this._restInterval  = null;
    this._restExIdx     = null; // exercise index that triggered the current rest
    this._restSi        = null;        // set index of the active timer row

    // Bind overlay events once in constructor using event delegation.
    // Since innerHTML is replaced on each _render(), using delegation on the
    // persistent element means handlers always work without re-attaching.
    this._overlay.addEventListener('input', e => this._onOverlayInput(e));
    this._overlay.addEventListener('click', e => this._onOverlayClick(e));
    this._bar.addEventListener('click', () => this._session && this._expand());
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async start(routineId) {
    // Prevent double-start
    if (this._session) return;

    // Load data in parallel
    const [exercises, sessions, routines, profile] = await Promise.all([
      dbGetAllExercises(),
      dbGetAllSessions(),
      dbGetAllRoutines(),
      dbGetProfile(),
    ]);

    this._exercises = exercises.filter(ex => !ex.isArchived);

    const routine = routineId ? routines.find(r => r.id === routineId) : null;

    // Build session
    this._session = {
      id: uid(),
      routineId: routineId || null,
      name: routine ? routine.name : t('session.free_name'),
      startTime: Date.now(),
      exercises: routine
        ? routine.exercises.map(ex => ({
            exerciseId: ex.exerciseId,
            sets: (ex.sets || []).map(s => ({
              type:      s.type   || 'normal',
              weight:    s.weight || 0,
              reps:      s.reps   || 0,
              completed: false,
              isPR:      false,
            })),
            note: ex.note || '',
          }))
        : [],
    };

    // Precompute PR history
    this._computePRHistory(sessions);

    // Rest duration from profile settings (default 90 s)
    this._restDuration = profile?.settings?.restDuration ?? 90;

    // Precompute previous sets (using setting or default same_routine)
    const prevMode = profile?.settings?.previousSets || 'same_routine';
    this._computePrevSets(sessions, routineId, prevMode);

    // Update global state
    setState('activeSession', this._session);

    // Start timer
    this._elapsed = 0;
    this._startTimer();

    // Show overlay
    this._render();
    this._show();
  }

  // ---------------------------------------------------------------------------
  // PR & previous sets computation
  // ---------------------------------------------------------------------------

  _computePRHistory(sessions) {
    this._prHistory = {};
    for (const sess of sessions) {
      for (const ex of (sess.exercises || [])) {
        for (const set of (ex.sets || [])) {
          if (set.completed && set.weight > 0 && set.reps > 0) {
            const e1rm = set.weight * (1 + set.reps / 30);
            if (!this._prHistory[ex.exerciseId] || e1rm > this._prHistory[ex.exerciseId]) {
              this._prHistory[ex.exerciseId] = e1rm;
            }
          }
        }
      }
    }
  }

  _computePrevSets(sessions, routineId, mode) {
    this._prevSets = {};
    let candidates = [...sessions];
    if (mode === 'same_routine' && routineId) {
      candidates = candidates.filter(s => s.routineId === routineId);
    }
    candidates.sort((a, b) => b.startTime - a.startTime);

    for (const ex of this._session.exercises) {
      for (const sess of candidates) {
        const found = (sess.exercises || []).find(e => e.exerciseId === ex.exerciseId);
        if (found) {
          this._prevSets[ex.exerciseId] = found.sets || [];
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  _startTimer() {
    this._timerInterval = setInterval(() => {
      this._elapsed++;
      this._updateTimerDisplay();
    }, 1000);
    setState('sessionTimer', this._timerInterval);
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    setState('sessionTimer', null);
  }

  _formatElapsed(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  _updateTimerDisplay() {
    const display = this._formatElapsed(this._elapsed);
    const timerEl = document.getElementById('session-timer');
    if (timerEl) timerEl.textContent = display;
    const barTimerEl = document.getElementById('session-bar-timer');
    if (barTimerEl) barTimerEl.textContent = display;
  }

  // ---------------------------------------------------------------------------
  // Show / hide / minimize
  // ---------------------------------------------------------------------------

  _show() {
    // Remove hidden, then animate in on next frame
    this._overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._overlay.classList.add('visible'));
    });
  }

  _hide() {
    this._overlay.classList.remove('visible');
    setTimeout(() => this._overlay.classList.add('hidden'), 400);
  }

  _minimize() {
    this._minimized = true;
    this._hide();
    this._renderBar();
    this._bar.classList.remove('hidden');
  }

  _expand() {
    this._minimized = false;
    this._bar.classList.add('hidden');
    this._show();
  }

  // ---------------------------------------------------------------------------
  // Render: minimized bar
  // ---------------------------------------------------------------------------

  _renderBar() {
    this._bar.innerHTML = `
      <span class="session-bar__name">${escapeHtml(this._session.name)}</span>
      <span class="session-bar__timer" id="session-bar-timer">${this._formatElapsed(this._elapsed)}</span>`;
    // Note: bar click is handled by the constructor-bound listener on this._bar
  }

  // ---------------------------------------------------------------------------
  // Render: full overlay
  // ---------------------------------------------------------------------------

  _render() {
    const exercisesHtml = this._session.exercises.map((ex, i) =>
      this._buildExerciseBlock(ex, i)
    ).join('');

    this._overlay.innerHTML = `
      <div class="session">
        <div class="session__header">
          <button class="btn btn--icon session__btn-minimize" data-action="minimize" aria-label="Réduire">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <button class="btn btn--icon session__btn-reset" data-action="reset-timer" aria-label="Réinitialiser">
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <span class="session__timer" id="session-timer">${this._formatElapsed(this._elapsed)}</span>
          <button class="session__btn-finish" data-action="finish">
            ${t('session.finish')}
          </button>
        </div>
        <div class="session__title-row">
          <span class="session__name">${escapeHtml(this._session.name)}</span>
        </div>
        <div class="session__content" id="session-content">
          ${exercisesHtml}
          <div class="session__bottom-actions">
            <button class="session-add-exercise" data-action="add-exercise">
              <i class="fa-solid fa-plus"></i>
              ${t('session.add_exercise')}
            </button>
            <button class="session-cancel" data-action="cancel-session">
              ${t('session.cancel')}
            </button>
          </div>
        </div>
      </div>`;
    // Event delegation handlers are already bound in constructor — no re-attach needed.

    // Re-append rest timer if a countdown was already running
    if (this._restInterval !== null) {
      this._renderRestTimer(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Build HTML: exercise block
  // ---------------------------------------------------------------------------

  _buildExerciseBlock(ex, exIdx) {
    const exercise = this._getExercise(ex.exerciseId);
    if (!exercise) return '';
    const color   = colorForId(ex.exerciseId);
    const initial = exercise.name.trim().charAt(0).toUpperCase();

    const setsHtml = this._buildSetsTable(ex, exIdx);

    return `
      <div class="session-exercise" id="session-ex-${exIdx}">
        <div class="session-exercise__header">
          <div class="session-exercise__icon" style="background:${color}22;color:${color};">
            ${initial}
          </div>
          <span class="session-exercise__name">${escapeHtml(exercise.name)}</span>
          <button class="btn btn--icon" data-action="open-ex-menu" data-ex-idx="${exIdx}" aria-label="Options">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
        <textarea
          class="session-exercise__note"
          placeholder="${t('session.note_ph')}"
          data-action="note-input"
          data-ex-idx="${exIdx}"
          rows="1"
        >${escapeHtml(ex.note || '')}</textarea>
        <div class="session-sets" id="session-sets-${exIdx}">
          ${setsHtml}
        </div>
        <button class="session-add-set" data-action="add-set" data-ex-idx="${exIdx}">
          <i class="fa-solid fa-plus"></i>${t('session.add_series')}
        </button>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Build HTML: sets table
  // ---------------------------------------------------------------------------

  _buildSetsTable(ex, exIdx) {
    const prevSets = this._prevSets[ex.exerciseId] || [];

    const headerRow = `
      <div class="session-sets__header">
        <span class="session-sets__col-set">${t('session.col_set')}</span>
        <span class="session-sets__col-prev">${t('session.col_prev')}</span>
        <span class="session-sets__col-kg">${t('session.col_kg')}</span>
        <span class="session-sets__col-reps">${t('session.col_reps')}</span>
        <span class="session-sets__col-check"></span>
      </div>`;

    const rows = ex.sets.map((set, si) => this._buildSetRow(set, si, exIdx, prevSets[si])).join('');

    return headerRow + rows;
  }

  _buildSetRow(set, si, exIdx, prevSet) {
    // Timer row — special layout, no weight/reps
    if (set.type === 'timer') {
      const doneClass = set.completed ? ' session-set-row--timer-done' : '';
      return `
      <div class="session-set-row session-set-row--timer${doneClass}" data-ex-idx="${exIdx}" data-si="${si}">
        <span class="session-set-row__timer-icon"><i class="fa-regular fa-clock"></i></span>
        <span class="session-set-row__timer-duration">${this._formatRestTime(set.duration ?? 90)}</span>
        ${set.completed
          ? `<i class="fa-solid fa-circle-check" style="color:var(--success);font-size:20px;padding:0 var(--space-3);"></i>`
          : `<button class="session-set-row__timer-start" data-action="start-timer-row" data-ex-idx="${exIdx}" data-si="${si}">DÉMARRER</button>`}
      </div>`;
    }

    const typeLabel = set.type === 'warmup' ? 'W' : set.type === 'drop' ? 'D' : set.type === 'failure' ? 'F' : String(si + 1);
    const typeClass = set.type === 'warmup' ? 'type-warmup' : set.type === 'drop' ? 'type-drop' : set.type === 'failure' ? 'type-failure' : 'type-normal';
    const doneClass = set.completed ? ' session-set-row--done' : '';
    const checkIcon = set.completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle-check';
    const checkClass = set.completed ? ' session-set-row__check--checked' : '';
    const prBadge   = set.isPR ? `<span class="session-set-row__pr">PR</span>` : '';

    const prevText = (prevSet && (prevSet.weight > 0 || prevSet.reps > 0))
      ? `${prevSet.weight > 0 ? prevSet.weight + 'kg' : ''}${prevSet.weight > 0 && prevSet.reps > 0 ? '×' : ''}${prevSet.reps > 0 ? prevSet.reps : ''}`
      : '—';

    return `
      <div class="session-set-row${doneClass}" data-ex-idx="${exIdx}" data-si="${si}">
        <button class="session-set-row__type ${typeClass}" data-action="show-type-picker" data-ex-idx="${exIdx}" data-si="${si}">
          ${typeLabel}
        </button>
        <span class="session-set-row__prev">${prevText}</span>
        <input
          class="session-set-row__input"
          type="number" min="0" step="0.5" inputmode="decimal"
          value="${set.weight > 0 ? set.weight : ''}"
          placeholder="—"
          data-field="weight" data-ex-idx="${exIdx}" data-si="${si}"
        >
        <input
          class="session-set-row__input"
          type="number" min="0" step="1" inputmode="numeric"
          value="${set.reps > 0 ? set.reps : ''}"
          placeholder="—"
          data-field="reps" data-ex-idx="${exIdx}" data-si="${si}"
        >
        <button class="session-set-row__check${checkClass}" data-action="toggle-set" data-ex-idx="${exIdx}" data-si="${si}">
          ${prBadge}<i class="${checkIcon}"></i>
        </button>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Targeted re-renders
  // ---------------------------------------------------------------------------

  _reRenderExerciseBlock(exIdx) {
    const el = document.getElementById(`session-ex-${exIdx}`);
    if (!el) return;
    const ex = this._session.exercises[exIdx];
    const html = this._buildExerciseBlock(ex, exIdx);
    const temp = document.createElement('div');
    temp.innerHTML = html;
    el.replaceWith(temp.firstElementChild);
    // Re-bind note textarea auto-resize (input events bubble to overlay handler)
  }

  _reRenderSetsSection(exIdx) {
    const setsEl = document.getElementById(`session-sets-${exIdx}`);
    if (!setsEl) return;
    const ex = this._session.exercises[exIdx];
    setsEl.innerHTML = this._buildSetsTable(ex, exIdx);
    // Si le timer de repos est actif sur cet exercice, le réinsérer
    if (this._restInterval && this._restExIdx === exIdx) {
      this._insertRestTimerBar();
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers (bound once in constructor via delegation)
  // ---------------------------------------------------------------------------

  _onOverlayInput(e) {
    const field = e.target.dataset.field;
    const exIdx = parseInt(e.target.dataset.exIdx);
    const si    = parseInt(e.target.dataset.si);

    // Weight / reps inputs
    if (field && !isNaN(exIdx) && !isNaN(si)) {
      const val = parseFloat(e.target.value) || 0;
      if (field === 'weight') this._session.exercises[exIdx].sets[si].weight = val;
      if (field === 'reps')   this._session.exercises[exIdx].sets[si].reps   = val;
      return;
    }

    // Note textarea
    if (e.target.dataset.action === 'note-input') {
      const idx = parseInt(e.target.dataset.exIdx);
      if (!isNaN(idx)) this._session.exercises[idx].note = e.target.value;
    }
  }

  _onOverlayClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const exIdx  = parseInt(target.dataset.exIdx);
    const si     = parseInt(target.dataset.si);

    switch (action) {
      case 'minimize':
        this._minimize();
        break;

      case 'reset-timer':
        this._elapsed = 0;
        this._updateTimerDisplay();
        break;

      case 'finish':
        this._finishSession();
        break;

      case 'cancel-session':
        this._confirmCancel();
        break;

      case 'add-exercise':
        this._openExercisePicker();
        break;

      case 'toggle-set':
        if (!isNaN(exIdx) && !isNaN(si)) this._toggleSet(exIdx, si);
        break;

      case 'show-type-picker':
        if (!isNaN(exIdx) && !isNaN(si)) this._showTypePicker(target, exIdx, si);
        break;

      case 'select-type': {
        const newType = target.dataset.type;
        if (!isNaN(exIdx) && !isNaN(si) && newType) {
          this._session.exercises[exIdx].sets[si].type = newType;
          document.querySelector('.session-type-popup')?.remove();
          this._reRenderSetsSection(exIdx);
        }
        break;
      }

      case 'add-timer-row': {
        if (!isNaN(exIdx) && !isNaN(si)) {
          const sets = this._session.exercises[exIdx].sets;
          if (sets[si + 1]?.type !== 'timer') {
            sets.splice(si + 1, 0, { type: 'timer', duration: this._restDuration, completed: false, weight: 0, reps: 0, isPR: false });
            document.querySelector('.session-type-popup')?.remove();
            this._reRenderSetsSection(exIdx);
          }
        }
        break;
      }

      case 'start-timer-row': {
        if (!isNaN(exIdx) && !isNaN(si)) {
          const set = this._session.exercises[exIdx]?.sets[si];
          if (set?.type === 'timer' && !set.completed) {
            this._startRestTimer(set.duration ?? this._restDuration, exIdx, si);
          }
        }
        break;
      }

      case 'add-set': {
        if (!isNaN(exIdx)) {
          const sets = this._session.exercises[exIdx].sets;
          const last = sets[sets.length - 1];
          sets.push({
            type:      'normal',
            weight:    last ? last.weight : 0,
            reps:      last ? last.reps   : 0,
            completed: false,
            isPR:      false,
          });
          this._reRenderSetsSection(exIdx);
        }
        break;
      }

      case 'open-ex-menu':
        if (!isNaN(exIdx)) this._openExerciseMenu(exIdx);
        break;

      case 'rest-skip':
        this._stopRestTimer();
        break;

      case 'rest-add-time': {
        this._restRemaining += 60;
        this._restTotal = Math.max(this._restTotal, this._restRemaining);
        // If timer had already expired, restart the interval
        if (!this._restInterval) {
          const el = document.getElementById('session-rest-timer');
          if (el) el.classList.remove('session-rest-bar--done');
          this._restInterval = setInterval(() => this._tickRestTimer(), 1000);
        }
        this._updateRestTimerDisplay();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Type picker popup
  // ---------------------------------------------------------------------------

  _showTypePicker(btn, exIdx, si) {
    // Remove any existing picker
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
      <button class="session-type-popup__item" data-action="select-type"
              data-ex-idx="${exIdx}" data-si="${si}" data-type="${tp.id}">
        <span class="session-type-popup__abbr">${escapeHtml(tp.abbr)}</span>
        <span>${escapeHtml(tp.label)}</span>
      </button>`).join('') +
      `<hr class="session-type-popup__divider">
      <button class="session-type-popup__item" data-action="add-timer-row"
              data-ex-idx="${exIdx}" data-si="${si}">
        <span class="session-type-popup__abbr session-type-popup__abbr--timer">
          <i class="fa-regular fa-clock"></i>
        </span>
        <span>Ajouter un minuteur</span>
      </button>`;

    // Position the popup below the button, clamped to viewport
    const rect = btn.getBoundingClientRect();
    document.body.appendChild(popup);
    const popupH = popup.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= popupH
      ? rect.bottom + 4
      : rect.top - popupH - 4;
    popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top  = `${top}px`;

    // Close on outside click
    const closePopup = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('pointerdown', closePopup, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', closePopup, true), 0);

    // Handle clicks inside popup (popup is in body, not in overlay → must self-handle)
    popup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action  = btn.dataset.action;
      const eIdx    = parseInt(btn.dataset.exIdx, 10);
      const sIdx    = parseInt(btn.dataset.si,    10);
      popup.remove();
      document.removeEventListener('pointerdown', closePopup, true);
      if (action === 'select-type' && !isNaN(eIdx) && !isNaN(sIdx)) {
        this._session.exercises[eIdx].sets[sIdx].type = btn.dataset.type;
        this._reRenderSetsSection(eIdx);
      } else if (action === 'add-timer-row' && !isNaN(eIdx) && !isNaN(sIdx)) {
        const sets = this._session.exercises[eIdx].sets;
        if (sets[sIdx + 1]?.type !== 'timer') {
          sets.splice(sIdx + 1, 0, { type: 'timer', duration: this._restDuration, completed: false, weight: 0, reps: 0, isPR: false });
          this._reRenderSetsSection(eIdx);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Toggle set completion + PR detection
  // ---------------------------------------------------------------------------

  _toggleSet(exIdx, si) {
    const ex  = this._session.exercises[exIdx];
    const set = ex.sets[si];
    set.completed = !set.completed;

    // Haptic feedback on completion
    if (set.completed) navigator.vibrate?.(40);

    if (set.completed && set.weight > 0 && set.reps > 0) {
      // Check for PR
      const e1rm = set.weight * (1 + set.reps / 30);
      const prev = this._prHistory[ex.exerciseId] || 0;
      if (e1rm > prev) {
        set.isPR = true;
        this._prHistory[ex.exerciseId] = e1rm;
        const exercise = this._getExercise(ex.exerciseId);
        this._showToast(`${t('session.new_pr')}${exercise ? ' — ' + exercise.name : ''}`, 'success');
      }
    } else {
      set.isPR = false;
    }

    // Stop any running timer when a set is uncompleted
    if (!set.completed) {
      this._stopRestTimer();
    }

    // Targeted DOM update of the set row only — preserves focus on other inputs
    const rowEl = this._overlay.querySelector(
      `[data-action="toggle-set"][data-ex-idx="${exIdx}"][data-si="${si}"]`
    )?.closest('.session-set-row');
    if (rowEl) {
      const newHtml = this._buildSetRow(set, si, exIdx, (this._prevSets[ex.exerciseId] || [])[si]);
      const temp = document.createElement('div');
      temp.innerHTML = newHtml;
      rowEl.replaceWith(temp.firstElementChild);
    }
  }

  // ---------------------------------------------------------------------------
  // Exercise menu (action sheet)
  // ---------------------------------------------------------------------------

  _openExerciseMenu(exIdx) {
    const ex       = this._session.exercises[exIdx];
    const exercise = this._getExercise(ex.exerciseId);
    const overlay  = document.getElementById('modal-overlay');

    overlay.innerHTML = `
      <div class="action-sheet">
        <div class="action-sheet__title">${exercise ? escapeHtml(exercise.name) : '?'}</div>
        <div class="action-sheet__item action-sheet__item--danger" data-action="remove-ex" data-ex-idx="${exIdx}">
          <i class="fa-solid fa-trash"></i>
          ${t('session.remove_exercise')}
        </div>
        <div class="action-sheet__item" data-action="close-sheet">
          <i class="fa-solid fa-xmark"></i>
          ${t('action.cancel')}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      if (e.target === overlay) { this._closeModal(); return; }
      const target = e.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'remove-ex') {
        this._session.exercises.splice(parseInt(target.dataset.exIdx), 1);
        this._closeModal();
        // Re-render entire overlay content to reflect removal
        this._render();
      } else if (target.dataset.action === 'close-sheet') {
        this._closeModal();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Exercise picker
  // ---------------------------------------------------------------------------

  _openExercisePicker() {
    let search = '';
    const overlay = document.getElementById('modal-overlay');

    const renderPicker = () => {
      let exercises = [...this._exercises];
      if (search) {
        const q = search.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        exercises = exercises.filter(ex =>
          ex.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q)
        );
      } else {
        exercises.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      }

      const items = exercises.map(ex => {
        const color   = colorForId(ex.id);
        const initial = ex.name.trim().charAt(0).toUpperCase();
        const muscle  = ex.muscleGroup ? t(`muscle.${ex.muscleGroup}`) : '';
        return `
          <div class="exercise-item" data-action="pick-exercise" data-id="${ex.id}">
            <div class="exercise-item__icon" style="background:${color}22;color:${color};">${initial}</div>
            <div class="exercise-item__body">
              <div class="exercise-item__name">${escapeHtml(ex.name)}</div>
              <div class="exercise-item__meta">${muscle}</div>
            </div>
          </div>`;
      }).join('');

      overlay.innerHTML = `
        <div class="picker-fullscreen">
          <div class="picker-fullscreen__header">
            <button class="btn btn--icon" data-action="close-picker"><i class="fa-solid fa-xmark"></i></button>
            <span class="picker-fullscreen__title">${t('workout.choose_exercise')}</span>
          </div>
          <div class="picker-fullscreen__search">
            <i class="fa-solid fa-magnifying-glass picker-fullscreen__search-icon"></i>
            <input class="picker-fullscreen__search-input" id="session-picker-search"
              type="search" placeholder="${t('exercises.search_ph')}"
              value="${escapeHtml(search)}" autocomplete="off" autocorrect="off">
          </div>
          <div class="picker-fullscreen__list exercises-list">
            <div class="exercises-group"><div class="exercises-group__items">${items}</div></div>
          </div>
        </div>`;
      overlay.classList.remove('hidden');

      // Re-bind search input after each re-render
      const searchInput = overlay.querySelector('#session-picker-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          search = e.target.value.trim();
          renderPicker();
          // Re-focus and restore cursor position to prevent jarring jump
          const inp = overlay.querySelector('#session-picker-search');
          if (inp) {
            inp.focus();
            inp.setSelectionRange(inp.value.length, inp.value.length);
          }
        });
      }
    };

    overlay.onclick = (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'close-picker') {
        this._closeModal();
        return;
      }
      if (target.dataset.action === 'pick-exercise') {
        const exId = target.dataset.id;
        this._session.exercises.push({
          exerciseId: exId,
          sets: [{ type: 'normal', weight: 0, reps: 0, completed: false, isPR: false }],
          note: '',
        });
        this._closeModal();
        this._render(); // Full re-render to include new exercise
      }
    };

    renderPicker();
    setTimeout(() => overlay.querySelector('#session-picker-search')?.focus(), 50);
  }

  // ---------------------------------------------------------------------------
  // Cancel confirmation
  // ---------------------------------------------------------------------------

  _confirmCancel() {
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="action-sheet">
        <div class="action-sheet__title">${t('session.cancel_confirm')}</div>
        <p style="padding:var(--space-3) var(--space-4);color:var(--text-secondary);font-size:var(--text-sm);">
          ${t('session.cancel_confirm_sub')}
        </p>
        <div class="action-sheet__item action-sheet__item--danger" data-action="confirm-cancel">
          <i class="fa-solid fa-stop"></i>
          ${t('session.cancel')}
        </div>
        <div class="action-sheet__item" data-action="close-sheet">
          <i class="fa-solid fa-arrow-left"></i>
          ${t('action.back')}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      if (e.target === overlay) { this._closeModal(); return; }
      const target = e.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'confirm-cancel') {
        this._closeModal();
        this._cancelSession();
      } else if (target.dataset.action === 'close-sheet') {
        this._closeModal();
      }
    };
  }

  _cancelSession() {
    this._stopTimer();
    this._stopRestTimerImmediate();
    setState('activeSession', null);
    this._session   = null;
    this._prevSets  = {};
    this._prHistory = {};
    this._bar.classList.add('hidden');
    this._hide();
  }

  // ---------------------------------------------------------------------------
  // Finish session
  // ---------------------------------------------------------------------------

  async _finishSession() {
    this._stopTimer();
    this._stopRestTimerImmediate();

    const endTime  = Date.now();
    const duration = Math.floor((endTime - this._session.startTime) / 1000);

    let totalVolume  = 0;
    let prCount      = 0;
    const finalExercises = [];

    for (const ex of this._session.exercises) {
      let bestSet = null;
      let best1RM = 0;

      for (const set of ex.sets) {
        if (set.completed) {
          if (set.weight > 0 && set.reps > 0) {
            totalVolume += set.weight * set.reps;
            const e1rm = set.weight * (1 + set.reps / 30);
            if (e1rm > best1RM) {
              best1RM = e1rm;
              bestSet = {
                weight:       set.weight,
                reps:         set.reps,
                estimated1RM: Math.round(e1rm * 2) / 2,
              };
            }
          }
          if (set.isPR) prCount++;
        }
      }

      const exercise = this._getExercise(ex.exerciseId);
      finalExercises.push({
        exerciseId:   ex.exerciseId,
        exerciseName: exercise ? exercise.name : '?',
        sets:         ex.sets,
        note:         ex.note || '',
        bestSet,
      });

      // Increment usageCount
      if (exercise) {
        exercise.usageCount = (exercise.usageCount || 0) + 1;
        await dbPutExercise(exercise).catch(() => {});
      }
    }

    // Build final session record
    const sessionRecord = {
      ...this._session,
      endTime,
      duration,
      totalVolume: Math.round(totalVolume * 10) / 10,
      prCount,
      exercises:  finalExercises,
      createdAt:  Date.now(),
    };

    // Persist session
    await dbPutSession(sessionRecord).catch(() => {});

    // Update routine lastUsedAt
    if (this._session.routineId) {
      const routines = await dbGetAllRoutines().catch(() => []);
      const routine  = routines.find(r => r.id === this._session.routineId);
      if (routine) {
        routine.lastUsedAt = endTime;
        await dbPutRoutine(routine).catch(() => {});
      }
    }

    // Update profile totalWorkouts
    const profile = await dbGetProfile().catch(() => null);
    if (profile) {
      profile.totalWorkouts = (profile.totalWorkouts || 0) + 1;
      await dbSaveProfile(profile).catch(() => {});
    }

    setState('activeSession', null);
    this._bar.classList.add('hidden');

    // Show summary modal
    this._showSummary(sessionRecord);
  }

  // ---------------------------------------------------------------------------
  // Session summary
  // ---------------------------------------------------------------------------

  _showSummary(session) {
    const overlay     = document.getElementById('modal-overlay');
    const durationStr = formatDuration(session.duration);
    const volumeStr   = `${session.totalVolume.toLocaleString('fr-FR')} kg`;

    const exerciseRows = session.exercises
      .filter(ex => ex.sets.some(s => s.completed))
      .map(ex => {
        const color   = colorForId(ex.exerciseId);
        const initial = ex.exerciseName.trim().charAt(0).toUpperCase();
        const best    = ex.bestSet
          ? `${t('session.best_set')} : ${ex.bestSet.weight}kg × ${ex.bestSet.reps}`
          : t('session.no_sets');
        return `
          <div class="session-summary__ex-item">
            <div class="session-summary__ex-icon" style="background:${color}22;color:${color};">${initial}</div>
            <div>
              <div class="session-summary__ex-name">${escapeHtml(ex.exerciseName)}</div>
              <div class="session-summary__ex-best">${best}</div>
            </div>
          </div>`;
      }).join('');

    overlay.innerHTML = `
      <div class="modal session-summary">
        <div class="modal__handle"></div>
        <div class="session-summary__header">
          <h2 class="session-summary__title">${t('session.summary_title')}</h2>
        </div>
        <div class="session-summary__stats">
          <div>
            <span class="session-summary__stat-label">${t('session.summary_duration')}</span>
            <span class="session-summary__stat-value">${durationStr}</span>
          </div>
          <div>
            <span class="session-summary__stat-label">${t('session.summary_volume')}</span>
            <span class="session-summary__stat-value">${volumeStr}</span>
          </div>
          <div>
            <span class="session-summary__stat-label">${t('session.summary_prs')}</span>
            <span class="session-summary__stat-value">${session.prCount > 0 ? session.prCount + ' 🏆' : '0'}</span>
          </div>
        </div>
        <div class="session-summary__exercises">
          ${exerciseRows || `<p style="color:var(--text-secondary);font-size:var(--text-sm);">${t('session.no_sets')}</p>`}
        </div>
        <div class="session-summary__footer">
          <button class="session-summary__close-btn" data-action="close-summary">
            ${t('action.done')}
          </button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      const target = e.target.closest('[data-action]');
      if (target?.dataset.action === 'close-summary' || e.target === overlay) {
        this._closeModal();
        this._hide();
        // Clean up session state
        this._session   = null;
        this._prevSets  = {};
        this._prHistory = {};
        this._elapsed   = 0;
        // Notify pages so they can refresh their data
        document.dispatchEvent(new CustomEvent('session-complete', { bubbles: true }));
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Rest timer — barre inline dans le bloc exercice
  // ---------------------------------------------------------------------------

  _startRestTimer(seconds, exIdx, si = null) {
    this._stopRestTimerImmediate();
    this._restExIdx     = exIdx ?? null;
    this._restSi        = si;
    this._restTotal     = seconds;
    this._restRemaining = seconds;
    this._restInterval  = setInterval(() => this._tickRestTimer(), 1000);
    this._insertRestTimerBar();
  }

  /** Suppression immédiate (bouton Ignorer) — réaffiche la ligne timer en idle */
  _stopRestTimer() {
    if (this._restInterval) {
      clearInterval(this._restInterval);
      this._restInterval = null;
    }
    const exIdx = this._restExIdx;
    this._restRemaining = 0;
    this._restTotal     = 0;
    this._restExIdx     = null;
    this._restSi        = null;
    document.getElementById('session-rest-timer')?.remove();
    // Re-render the exercise sets so the timer row returns to idle state
    if (exIdx !== null) this._reRenderSetsSection(exIdx);
  }

  /** Suppression instantanée (annulation / fin de séance) */
  _stopRestTimerImmediate() {
    if (this._restInterval) {
      clearInterval(this._restInterval);
      this._restInterval = null;
    }
    this._restRemaining = 0;
    this._restTotal     = 0;
    this._restExIdx     = null;
    this._restSi        = null;
    document.getElementById('session-rest-timer')?.remove();
  }

  _tickRestTimer() {
    this._restRemaining = Math.max(0, this._restRemaining - 1);
    if (this._restRemaining <= 0) {
      clearInterval(this._restInterval);
      this._restInterval = null;
      this._updateRestTimerDisplay();
      navigator.vibrate?.([200, 100, 200]);

      // Mark the timer set as completed
      const exIdx = this._restExIdx;
      const si    = this._restSi;
      const set   = this._session?.exercises[exIdx]?.sets[si];
      if (set?.type === 'timer') set.completed = true;

      const el = document.getElementById('session-rest-timer');
      if (el) el.classList.add('session-rest-bar--done');

      // After 2.5 s, replace bar with the done row
      setTimeout(() => {
        this._restExIdx = null;
        this._restSi    = null;
        document.getElementById('session-rest-timer')?.remove();
        if (exIdx !== null) this._reRenderSetsSection(exIdx);
      }, 2500);
      return;
    }
    this._updateRestTimerDisplay();
  }

  /**
   * Insère (ou réinsère après un _reRenderSetsSection) la barre de repos
   * dans le tableau de séries de l'exercice courant, après la dernière série
   * complétée.
   */
  _insertRestTimerBar() {
    document.getElementById('session-rest-timer')?.remove();
    const exIdx = this._restExIdx;
    const si    = this._restSi;
    if (exIdx === null) return;

    const fillPct = this._restTotal > 0
      ? ((this._restRemaining / this._restTotal) * 100).toFixed(1)
      : '100';

    const el = document.createElement('div');
    el.id        = 'session-rest-timer';
    el.className = 'session-rest-bar';
    el.innerHTML = `
      <div class="session-rest-bar__fill" id="session-rest-fill" style="width:${fillPct}%"></div>
      <div class="session-rest-bar__content">
        <button class="session-rest-bar__btn" data-action="rest-add-time">+1:00</button>
        <span class="session-rest-bar__time" id="session-rest-time">${this._formatRestTime(this._restRemaining)}</span>
        <button class="session-rest-bar__btn" data-action="rest-skip">IGNORER</button>
      </div>`;

    // Replace the idle timer row if found, otherwise append to the sets container
    const timerRow = si !== null
      ? this._overlay.querySelector(`.session-set-row--timer[data-ex-idx="${exIdx}"][data-si="${si}"]`)
      : null;
    if (timerRow) {
      timerRow.replaceWith(el);
    } else {
      const setsEl = document.getElementById(`session-sets-${exIdx}`);
      if (setsEl) setsEl.appendChild(el);
    }
  }

  _updateRestTimerDisplay() {
    const timeEl = document.getElementById('session-rest-time');
    const fillEl = document.getElementById('session-rest-fill');
    if (timeEl) timeEl.textContent = this._formatRestTime(this._restRemaining);
    if (fillEl) {
      const pct = this._restTotal > 0
        ? ((this._restRemaining / this._restTotal) * 100).toFixed(1)
        : '0';
      fillEl.style.width = `${pct}%`;
    }
  }

  _formatRestTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  _showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast--visible')));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _getExercise(id) {
    return this._exercises.find(ex => ex.id === id);
  }

  _closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      overlay.onclick   = null;
    }
  }
}
