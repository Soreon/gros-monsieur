import { t } from '../i18n.js';
import {
  uid,
  formatDuration,
  formatDateShort,
  estimate1RM,
  escapeHtml,
  colorForId,
  normalize,
} from '../utils/helpers.js';
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

// Clé localStorage du brouillon de séance active (persistance anti-crash/refresh)
const DRAFT_KEY = 'gm-active-session';

// Calculateur de disques : jeu standard de disques (kg, par côté, ordre
// décroissant pour l'algorithme glouton) et barres proposées (kg)
const PLATE_SET   = [25, 20, 15, 10, 5, 2.5, 1.25];
const BAR_OPTIONS = [20, 15, 10, 7.5, 6];

export default class SessionOverlay {
  constructor() {
    this._overlay   = document.getElementById('session-overlay');
    this._bar       = document.getElementById('session-bar');
    this._session   = null;        // active session object
    this._exercises = [];          // all non-archived exercises
    this._elapsed   = 0;          // seconds since session start
    this._minimized = false;
    this._prevSets  = {};          // {exerciseId: [{weight,reps,type}]} (séries complétées non-timer)
    this._prHistory = {};          // {exerciseId: maxEstimated1RM} (historique + séance en cours)
    this._basePRHistory = {};      // {exerciseId: maxEstimated1RM} (historique seul, pour rollback PR)
    this._timerInterval = null;
    this._handlers  = {};
    this._settings  = {};          // profile.settings, chargé au start/resume
    this._finishing = false;       // garde de réentrance de _finishSession
    this._hideTimeout  = null;     // setTimeout de _hide() (annulé par _show())
    this._draftTimeout = null;     // debounce de sauvegarde du brouillon
    this._wakeLock     = null;     // Screen Wake Lock sentinel
    this._audioCtx     = null;     // AudioContext lazy pour les bips (soundEffects)

    // Inline rest timer state (barre dans les séries, indépendant)
    // Basé sur timestamp (_restEndsAt) : fiable même si setInterval est
    // throttlé/suspendu en arrière-plan (mobile, écran verrouillé).
    this._restDuration  = 90;  // seconds, overridden from profile on session start
    this._restRemaining = 0;
    this._restTotal     = 0;
    this._restEndsAt    = 0;    // timestamp (ms) de fin du décompte
    this._restInterval  = null;
    this._restDoneTimeout = null; // setTimeout de nettoyage post-fin (2.5 s)
    this._restEx        = null; // référence de l'exercice (objet) qui a déclenché le repos
    this._restSet       = null; // référence du set timer (objet) — insensible aux splice/reorder

    // Global timer state (pill header + modale, indépendant)
    this._globalInterval  = null;
    this._globalRemaining = 0;
    this._globalTotal     = 0;
    this._globalEndsAt    = 0;    // timestamp (ms) de fin du décompte
    this._globalDoneTimeout = null; // setTimeout de nettoyage post-fin (2.5 s)

    // Swipe-to-delete state
    this._swipeRow     = null;   // .session-set-row en cours de swipe
    this._swipeStartX  = 0;
    this._swipeStartY  = 0;
    this._swipeDir     = null;   // 'h' | 'v' | null
    this._openSwipeRow = null;   // .session-set-row actuellement révélé

    // Long press / reorder state
    this._lpTimer      = null;
    this._lpStartX     = 0;
    this._lpStartY     = 0;
    this._lpExIdx      = -1;

    // Drag-to-reorder state (active while finger is held after long press)
    this._reorderActive    = false;
    this._reorderDragging  = null;   // item DOM element being dragged
    this._reorderStartY    = 0;      // touch Y when drag started
    this._reorderStartIdx  = -1;
    this._reorderTargetIdx = -1;
    this._reorderMids      = [];     // milieux (Y) des items capturés au début du drag

    // Bind overlay events once in constructor using event delegation.
    // Since innerHTML is replaced on each _render(), using delegation on the
    // persistent element means handlers always work without re-attaching.
    this._overlay.addEventListener('input',       e => this._onOverlayInput(e));
    this._overlay.addEventListener('click',       e => this._onOverlayClick(e));
    this._overlay.addEventListener('touchstart',  e => this._onTouchStart(e),  { passive: true });
    this._overlay.addEventListener('touchmove',   e => this._onTouchMove(e),   { passive: false });
    this._overlay.addEventListener('touchend',    e => this._onTouchEnd(e));
    this._overlay.addEventListener('touchcancel', e => this._onTouchCancel(e));
    this._bar.addEventListener('click', () => this._session && this._expand());

    // Resynchronise les timers (basés timestamp) au retour au premier plan et
    // ré-acquiert le wake lock (libéré par le navigateur en arrière-plan).
    this._onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !this._session) return;
      this._syncElapsed();
      this._updateTimerDisplay();
      if (this._restInterval)   this._tickRestTimer();
      if (this._globalInterval) this._tickGlobalTimer();
      if (!this._minimized) this._acquireWakeLock();
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Démarre une séance.
   * @param {string|object|null} routineOrId
   *   - string : id d'une routine persistée en base (flux classique)
   *   - object : routine éphémère non persistée (ex. « Refaire cette séance »
   *     depuis l'historique) — {id?, name, exercises: [{exerciseId, sets, note?}]}
   *   - null   : séance libre
   */
  async start(routineOrId) {
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

    // Routine éphémère (objet) ou routine persistée (id) ?
    const isEphemeral = routineOrId !== null && typeof routineOrId === 'object';
    const routine = isEphemeral
      ? routineOrId
      : (routineOrId ? routines.find(r => r.id === routineOrId) : null);
    // routineId : conservé pour prev-sets / lastUsedAt. Une routine éphémère
    // peut porter l'id de la routine d'origine (ou null si séance libre).
    const routineId = isEphemeral ? (routine.id ?? null) : (routineOrId || null);

    // Garde défensive : routine introuvable ou sans exercices valides
    const routineExercises = routine
      ? (Array.isArray(routine.exercises) ? routine.exercises : [])
      : [];
    if ((routineId || isEphemeral) && (!routine || routineExercises.length === 0)) {
      this._showToast(t('session.routine_empty'), 'error');
      return;
    }

    // Build session
    this._session = {
      id: uid(),
      routineId: routineId || null,
      name: routine ? routine.name : t('session.free_name'),
      startTime: Date.now(),
      exercises: routineExercises.map(ex => ({
        exerciseId: ex.exerciseId,
        sets: (ex.sets || []).map(s => ({
          type:      s.type   || 'normal',
          weight:    s.weight || 0,
          reps:      s.reps   || 0,
          completed: false,
          isPR:      false,
        })),
        note: ex.note || '',
      })),
    };
    this._finishing = false;

    // Precompute PR history
    this._computePRHistory(sessions);

    // Profile settings (rest duration, lockCompletedSets, soundEffects, …)
    this._applyProfileSettings(profile);

    // Precompute previous sets (using setting or default same_routine)
    const prevMode = profile?.settings?.previousSets || 'same_routine';
    this._computePrevSets(sessions, routineId, prevMode);

    // Update global state
    setState('activeSession', this._session);

    // Persist draft immediately (crash/refresh recovery)
    this._saveDraft();

    // Start timer
    this._syncElapsed();
    this._startTimer();

    // Show overlay
    this._render();
    this._show();
  }

  /**
   * Reprend une séance interrompue depuis le brouillon localStorage.
   * Appelé au démarrage de l'app (app.js). La séance reprend automatiquement
   * en mode minimisé (barre de session visible) : non-intrusif, l'utilisateur
   * agrandit d'un tap ou peut annuler normalement.
   *
   * @returns {Promise<boolean>} true si une séance a été reprise
   */
  async resumeDraft() {
    if (this._session) return false;

    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch {
      draft = null;
    }
    if (!draft || !draft.id || !draft.startTime || !Array.isArray(draft.exercises)) {
      this._clearDraft();
      return false;
    }

    const [exercises, sessions, profile] = await Promise.all([
      dbGetAllExercises(),
      dbGetAllSessions(),
      dbGetProfile(),
    ]);

    this._exercises = exercises.filter(ex => !ex.isArchived);
    this._session   = draft;
    this._finishing = false;

    this._computePRHistory(sessions);
    // Réintègre les PR déjà validés dans le brouillon
    for (const ex of this._session.exercises) {
      this._recomputeExercisePR(ex.exerciseId);
    }

    this._applyProfileSettings(profile);
    const prevMode = profile?.settings?.previousSets || 'same_routine';
    this._computePrevSets(sessions, draft.routineId, prevMode);

    setState('activeSession', this._session);

    // Le chrono se recalcule depuis startTime (rien à persister)
    this._syncElapsed();
    this._startTimer();

    this._render();
    this._minimize();
    this._showToast(t('session.resumed'), 'success');
    return true;
  }

  /** Applique les réglages du profil sur l'état interne. */
  _applyProfileSettings(profile) {
    this._settings = profile?.settings ?? {};
    // Durée de repos par défaut : settings.restTimer.defaultSeconds (cf. db.js)
    this._restDuration = profile?.settings?.restTimer?.defaultSeconds ?? 90;
  }

  // ---------------------------------------------------------------------------
  // Draft persistence (localStorage) — reprise après refresh/crash
  // ---------------------------------------------------------------------------

  /** Sauvegarde immédiate du brouillon (mutations importantes : toggle, splice…). */
  _saveDraft() {
    if (!this._session) return;
    clearTimeout(this._draftTimeout);
    this._draftTimeout = null;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(this._session));
    } catch { /* quota / private mode — non bloquant */ }
  }

  /** Sauvegarde débouncée (~300 ms) pour les saisies clavier (kg/reps/note). */
  _saveDraftDebounced() {
    clearTimeout(this._draftTimeout);
    this._draftTimeout = setTimeout(() => this._saveDraft(), 300);
  }

  /** Supprime le brouillon (fin ou annulation de séance). */
  _clearDraft() {
    clearTimeout(this._draftTimeout);
    this._draftTimeout = null;
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch { /* non bloquant */ }
  }

  // ---------------------------------------------------------------------------
  // PR & previous sets computation
  // ---------------------------------------------------------------------------

  _computePRHistory(sessions) {
    this._basePRHistory = {};
    for (const sess of sessions) {
      for (const ex of (sess.exercises || [])) {
        for (const set of (ex.sets || [])) {
          if (set.completed && set.weight > 0 && set.reps > 0) {
            const e1rm = estimate1RM(set.weight, set.reps);
            if (!this._basePRHistory[ex.exerciseId] || e1rm > this._basePRHistory[ex.exerciseId]) {
              this._basePRHistory[ex.exerciseId] = e1rm;
            }
          }
        }
      }
    }
    this._prHistory = { ...this._basePRHistory };
  }

  /**
   * Recalcule le meilleur 1RM d'un exercice : historique (base) + séries
   * cochées de la séance en cours. Utilisé au décochage/suppression d'une
   * série pour que le PR redevienne détectable au re-cochage.
   */
  _recomputeExercisePR(exerciseId) {
    let best = this._basePRHistory[exerciseId] || 0;
    for (const ex of (this._session?.exercises || [])) {
      if (ex.exerciseId !== exerciseId) continue;
      for (const set of ex.sets) {
        if (set.completed && set.type !== 'timer') {
          const e1rm = estimate1RM(set.weight, set.reps);
          if (e1rm > best) best = e1rm;
        }
      }
    }
    if (best > 0) this._prHistory[exerciseId] = best;
    else delete this._prHistory[exerciseId];
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
          // Ne garder que les séries non-timer COMPLÉTÉES : la colonne
          // « précédent » s'aligne alors correctement sur les lignes du jour.
          this._prevSets[ex.exerciseId] = (found.sets || [])
            .filter(s => s.completed && s.type !== 'timer');
          break;
        }
      }
    }
  }

  /**
   * Série « précédente » alignée sur la position non-timer de la série si :
   * les lignes timer de la séance courante ne décalent plus l'index.
   */
  _prevSetFor(ex, si) {
    const prev = this._prevSets[ex.exerciseId] || [];
    let idx = 0;
    for (let i = 0; i < si; i++) {
      if (ex.sets[i]?.type !== 'timer') idx++;
    }
    return prev[idx];
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  /** Recalcule _elapsed depuis startTime (fiable après throttling/suspension). */
  _syncElapsed() {
    if (!this._session) return;
    this._elapsed = Math.max(0, Math.floor((Date.now() - this._session.startTime) / 1000));
  }

  _startTimer() {
    this._stopTimer();
    this._timerInterval = setInterval(() => {
      this._syncElapsed();
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
    // Annule un _hide() en cours (réduire puis ré-agrandir < 400 ms)
    clearTimeout(this._hideTimeout);
    this._hideTimeout = null;
    // Remove hidden, then animate in on next frame
    this._overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._overlay.classList.add('visible'));
    });
    // Écran allumé pendant la séance en plein écran
    if (this._session) this._acquireWakeLock();
  }

  _hide() {
    this._overlay.classList.remove('visible');
    clearTimeout(this._hideTimeout);
    this._hideTimeout = setTimeout(() => {
      this._overlay.classList.add('hidden');
      this._hideTimeout = null;
    }, 400);
    this._releaseWakeLock();
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
    this._openSwipeRow = null;
    const exercisesHtml = this._session.exercises.map((ex, i) =>
      this._buildExerciseBlock(ex, i)
    ).join('');

    this._overlay.innerHTML = `
      <div class="session">
        <div class="session__header">
          <button class="btn btn--icon session__btn-minimize" data-action="minimize" aria-label="Réduire">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <button class="session__btn-timer${this._globalInterval ? ' session__btn-timer--running' : ''}" data-action="open-timer-modal" aria-label="Minuteur de repos">
            <i class="fa-regular fa-stopwatch fa-lg"></i>${this._globalInterval ? ` ${this._formatRestTime(this._globalRemaining)}` : ''}
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

    // Re-insert inline bar and update header pill if a countdown was already running
    if (this._restInterval !== null) {
      this._insertRestTimerBar();
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
    const headerRow = `
      <div class="session-sets__header">
        <span class="session-sets__col-set">${t('session.col_set')}</span>
        <span class="session-sets__col-prev">${t('session.col_prev')}</span>
        <span class="session-sets__col-kg">${t('session.col_kg')}</span>
        <span class="session-sets__col-reps">${t('session.col_reps')}</span>
        <span class="session-sets__col-check"></span>
      </div>`;

    const rows = ex.sets.map((set, si) => this._buildSetRow(set, si, exIdx, this._prevSetFor(ex, si))).join('');

    return headerRow + rows;
  }

  _buildSetRow(set, si, exIdx, prevSet) {
    // Timer row — special layout, no weight/reps
    if (set.type === 'timer') {
      const doneClass = set.completed ? ' session-set-row--timer-done' : '';
      return `
      <div class="session-set-row session-set-row--timer${doneClass}" data-ex-idx="${exIdx}" data-si="${si}">
        <span class="session-set-row__timer-icon"><i class="fa-regular fa-stopwatch fa-lg"></i></span>
        <span class="session-set-row__timer-duration">${this._formatRestTime(set.duration ?? 90)}</span>
        ${set.completed
          ? `<i class="fa-solid fa-circle-check" style="color:var(--success);font-size:20px;padding:0 var(--space-3);"></i>`
          : `<button class="session-set-row__timer-start" data-action="start-timer-row" data-ex-idx="${exIdx}" data-si="${si}">DÉMARRER</button>
             <button class="session-set-row__timer-remove" data-action="remove-timer-row" data-ex-idx="${exIdx}" data-si="${si}" aria-label="Supprimer le minuteur"><i class="fa-solid fa-xmark"></i></button>`}
      </div>`;
    }

    const typeLabel = set.type === 'warmup' ? 'W' : set.type === 'drop' ? 'D' : set.type === 'failure' ? 'F' : String(si + 1);
    const typeClass = set.type === 'warmup' ? 'type-warmup' : set.type === 'drop' ? 'type-drop' : set.type === 'failure' ? 'type-failure' : 'type-normal';
    // Réglage lockCompletedSets : série cochée → inputs en lecture seule
    const locked    = !!(this._settings.lockCompletedSets && set.completed);
    const lockAttr  = locked ? ' disabled' : '';
    const doneClass = set.completed ? ' session-set-row--done' : '';
    const checkIcon = set.completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle-check';
    const checkClass = set.completed ? ' session-set-row__check--checked' : '';
    const prBadge   = set.isPR ? `<span class="session-set-row__pr">PR</span>` : '';

    const prevText = (prevSet && (prevSet.weight > 0 || prevSet.reps > 0))
      ? `${prevSet.weight > 0 ? prevSet.weight + 'kg' : ''}${prevSet.weight > 0 && prevSet.reps > 0 ? '×' : ''}${prevSet.reps > 0 ? prevSet.reps : ''}`
      : '—';

    return `
      <div class="set-row-wrap">
        <button class="set-row-delete" data-action="delete-set" data-ex-idx="${exIdx}" data-si="${si}" aria-label="Supprimer la série">
          <i class="fa-solid fa-trash"></i>
        </button>
        <div class="session-set-row${doneClass}" data-ex-idx="${exIdx}" data-si="${si}">
          <button class="session-set-row__type ${typeClass}" data-action="show-type-picker" data-ex-idx="${exIdx}" data-si="${si}"${lockAttr}>
            ${typeLabel}
          </button>
          <span class="session-set-row__prev">${prevText}</span>
          <input
            class="session-set-row__input"
            type="number" min="0" step="0.5" inputmode="decimal"
            value="${set.weight > 0 ? set.weight : ''}"
            placeholder="—"
            data-field="weight" data-ex-idx="${exIdx}" data-si="${si}"${lockAttr}
          >
          <input
            class="session-set-row__input"
            type="number" min="0" step="1" inputmode="numeric"
            value="${set.reps > 0 ? set.reps : ''}"
            placeholder="—"
            data-field="reps" data-ex-idx="${exIdx}" data-si="${si}"${lockAttr}
          >
          <button class="session-set-row__check${checkClass}" data-action="toggle-set" data-ex-idx="${exIdx}" data-si="${si}">
            ${prBadge}<i class="${checkIcon}"></i>
          </button>
        </div>
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
    if (this._openSwipeRow && setsEl.contains(this._openSwipeRow)) this._openSwipeRow = null;
    const ex = this._session.exercises[exIdx];
    setsEl.innerHTML = this._buildSetsTable(ex, exIdx);
    // Si le timer de repos est actif sur cet exercice, le réinsérer
    if (this._restInterval && this._restEx === ex) {
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

    // Weight / reps inputs (clampés à 0 : pas de valeurs négatives)
    if (field && !isNaN(exIdx) && !isNaN(si)) {
      const val = Math.max(0, parseFloat(e.target.value) || 0);
      if (field === 'weight') this._session.exercises[exIdx].sets[si].weight = val;
      if (field === 'reps')   this._session.exercises[exIdx].sets[si].reps   = val;
      this._saveDraftDebounced();
      return;
    }

    // Note textarea
    if (e.target.dataset.action === 'note-input') {
      const idx = parseInt(e.target.dataset.exIdx);
      if (!isNaN(idx)) {
        this._session.exercises[idx].note = e.target.value;
        this._saveDraftDebounced();
      }
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
        // Le chrono est calculé depuis startTime : reset = nouveau startTime
        if (this._session) {
          this._session.startTime = Date.now();
          this._saveDraft();
        }
        this._syncElapsed();
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
          this._saveDraft();
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
            this._saveDraft();
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

      case 'remove-timer-row': {
        // Timer rows : suppression directe sans confirmation
        if (!isNaN(exIdx) && !isNaN(si)) {
          this._session.exercises[exIdx].sets.splice(si, 1);
          this._saveDraft();
          this._reRenderSetsSection(exIdx);
        }
        break;
      }

      case 'delete-set': {
        // Séries normales : confirmation selon le réglage confirmDeleteSet
        if (!isNaN(exIdx) && !isNaN(si)) {
          this._requestDeleteSet(exIdx, si);
        }
        break;
      }

      case 'cancel-delete':
        document.getElementById('session-delete-confirm')?.remove();
        this._closeOpenSwipeRow();
        break;

      case 'confirm-delete': {
        document.getElementById('session-delete-confirm')?.remove();
        if (!isNaN(exIdx) && !isNaN(si)) {
          this._deleteSet(exIdx, si);
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
          this._saveDraft();
          this._reRenderSetsSection(exIdx);
        }
        break;
      }

      case 'open-ex-menu':
        if (!isNaN(exIdx)) this._openExerciseMenu(exIdx);
        break;

      // Inline rest bar controls
      case 'rest-skip':
        this._stopRestTimer();
        break;

      case 'rest-add-time': {
        clearTimeout(this._restDoneTimeout);
        this._restDoneTimeout = null;
        // Base timestamp : fin en cours si le timer tourne, sinon maintenant
        this._restEndsAt    = (this._restInterval ? this._restEndsAt : Date.now()) + 60000;
        this._restRemaining = Math.max(0, Math.ceil((this._restEndsAt - Date.now()) / 1000));
        this._restTotal     = Math.max(this._restTotal, this._restRemaining);
        if (!this._restInterval) {
          const el = document.getElementById('session-rest-timer');
          if (el) el.classList.remove('session-rest-bar--done');
          this._restInterval = setInterval(() => this._tickRestTimer(), 1000);
        }
        this._updateRestTimerDisplay();
        break;
      }

      // Global timer modal controls
      case 'timer-skip':
        this._stopGlobalTimer();
        break;

      case 'timer-adjust': {
        const delta = parseInt(target.dataset.delta, 10);
        if (!isNaN(delta)) {
          clearTimeout(this._globalDoneTimeout);
          this._globalDoneTimeout = null;
          const base = this._globalInterval
            ? this._globalEndsAt
            : Date.now() + this._globalRemaining * 1000;
          this._globalEndsAt    = Math.max(Date.now() + 1000, base + delta * 1000);
          this._globalRemaining = Math.max(1, Math.ceil((this._globalEndsAt - Date.now()) / 1000));
          this._globalTotal     = Math.max(this._globalTotal, this._globalRemaining);
          if (!this._globalInterval) {
            document.getElementById('session-timer-modal')?.classList.remove('timer-modal--done');
            this._globalInterval = setInterval(() => this._tickGlobalTimer(), 1000);
          }
          this._updateGlobalTimerModal();
          this._updateTimerBtn();
        }
        break;
      }

      case 'open-timer-modal':
        this._showTimerModal();
        break;

      case 'timer-modal-close':
        document.getElementById('session-timer-modal')?.remove();
        break;

      case 'timer-preset': {
        const secs = parseInt(target.dataset.seconds, 10);
        if (!isNaN(secs)) {
          this._startGlobalTimer(secs);
          this._showTimerModal();
        }
        break;
      }

      case 'timer-custom': {
        const modal = document.getElementById('session-timer-modal');
        if (!modal) break;
        modal.innerHTML = `
          <div class="timer-modal__header">
            <button class="timer-modal__close" data-action="timer-modal-close"><i class="fa-solid fa-xmark"></i></button>
            <span class="timer-modal__title">Minuteur personnalisé</span>
            <span></span>
          </div>
          <div class="timer-modal__custom-form">
            <label class="timer-modal__custom-label">Durée (minutes)</label>
            <input class="timer-modal__custom-input" id="timer-custom-input" type="number" min="1" max="60" value="3" inputmode="numeric">
            <button class="timer-modal__custom-start" data-action="timer-custom-start">DÉMARRER</button>
          </div>`;
        setTimeout(() => document.getElementById('timer-custom-input')?.focus(), 50);
        break;
      }

      case 'timer-custom-start': {
        const val = parseInt(document.getElementById('timer-custom-input')?.value, 10);
        if (!isNaN(val) && val > 0) {
          this._startGlobalTimer(val * 60);
          this._showTimerModal();
        }
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
          <i class="fa-regular fa-stopwatch fa-lg"></i>
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
        this._saveDraft();
        this._reRenderSetsSection(eIdx);
      } else if (action === 'add-timer-row' && !isNaN(eIdx) && !isNaN(sIdx)) {
        const sets = this._session.exercises[eIdx].sets;
        if (sets[sIdx + 1]?.type !== 'timer') {
          sets.splice(sIdx + 1, 0, { type: 'timer', duration: this._restDuration, completed: false, weight: 0, reps: 0, isPR: false });
          this._saveDraft();
          this._reRenderSetsSection(eIdx);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Set deletion (réglage confirmDeleteSet)
  // ---------------------------------------------------------------------------

  /** Supprime avec ou sans confirmation selon le réglage confirmDeleteSet. */
  _requestDeleteSet(exIdx, si) {
    if (this._settings.confirmDeleteSet === false) {
      this._deleteSet(exIdx, si);
    } else {
      this._showDeleteConfirmation(exIdx, si);
    }
  }

  _deleteSet(exIdx, si) {
    const sets = this._session?.exercises[exIdx]?.sets;
    if (!sets || !sets[si]) return;
    const [removed] = sets.splice(si, 1);
    // Si une série PR est supprimée, le meilleur 1RM doit être recalculé
    if (removed?.isPR) this._recomputeExercisePR(this._session.exercises[exIdx].exerciseId);
    this._saveDraft();
    this._reRenderSetsSection(exIdx);
  }

  // ---------------------------------------------------------------------------
  // Toggle set completion + PR detection
  // ---------------------------------------------------------------------------

  _toggleSet(exIdx, si) {
    const ex  = this._session.exercises[exIdx];
    const set = ex.sets[si];
    set.completed = !set.completed;

    // Haptic + sound feedback on completion
    if (set.completed) {
      navigator.vibrate?.(40);
      this._playBeep(1);
    }

    if (set.completed && set.weight > 0 && set.reps > 0) {
      // Check for PR
      const e1rm = estimate1RM(set.weight, set.reps);
      const prev = this._prHistory[ex.exerciseId] || 0;
      if (e1rm > prev) {
        set.isPR = true;
        this._prHistory[ex.exerciseId] = e1rm;
        const exercise = this._getExercise(ex.exerciseId);
        this._showToast(`${t('session.new_pr')}${exercise ? ' — ' + exercise.name : ''}`, 'success');
      }
    } else {
      // Décochage : rollback du meilleur 1RM pour que le PR soit
      // à nouveau détectable si la série est re-cochée.
      set.isPR = false;
      this._recomputeExercisePR(ex.exerciseId);
    }

    if (set.completed) {
      // Auto-start timer if the next row is a timer row (planned rest)
      const nextSet = ex.sets[si + 1];
      if (nextSet?.type === 'timer' && !nextSet.completed && !this._restInterval) {
        this._startRestTimer(nextSet.duration ?? this._restDuration, exIdx, si + 1);
      }
    } else {
      // Stop any running timer when a set is uncompleted
      this._stopRestTimer();
    }

    // Mutation importante : flush immédiat du brouillon
    this._saveDraft();

    // Targeted DOM update — replace the whole .set-row-wrap (or .session-set-row for timer rows)
    const toggleBtn = this._overlay.querySelector(
      `[data-action="toggle-set"][data-ex-idx="${exIdx}"][data-si="${si}"]`
    );
    const rowEl = toggleBtn?.closest('.set-row-wrap') ?? toggleBtn?.closest('.session-set-row');
    if (rowEl) {
      const newHtml = this._buildSetRow(set, si, exIdx, this._prevSetFor(ex, si));
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
        <div class="action-sheet__item" data-action="open-plate-calc" data-ex-idx="${exIdx}">
          <i class="fa-solid fa-calculator"></i>
          ${t('plates.title')}
        </div>
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
      if (target.dataset.action === 'open-plate-calc') {
        // Remplace le contenu du modal-overlay (et son onclick) par le calculateur
        this._openPlateCalc(parseInt(target.dataset.exIdx, 10));
      } else if (target.dataset.action === 'remove-ex') {
        const [removed] = this._session.exercises.splice(parseInt(target.dataset.exIdx), 1);
        // Si le repos en cours appartenait à cet exercice, l'arrêter
        if (removed && this._restEx === removed) this._stopRestTimerImmediate();
        if (removed) this._recomputeExercisePR(removed.exerciseId);
        this._saveDraft();
        this._closeModal();
        // Re-render entire overlay content to reflect removal
        this._render();
      } else if (target.dataset.action === 'close-sheet') {
        this._closeModal();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Plate calculator — calculateur de disques par exercice
  // ---------------------------------------------------------------------------

  /**
   * Répartition gloutonne des disques PAR CÔTÉ pour charger `total` kg sur
   * une barre de `bar` kg. Calcul en quarts de kg (entiers : 1.25 kg = 5)
   * pour éviter les erreurs d'arrondi flottant.
   *
   * @returns {{perSide: {weight:number,count:number}[], achieved:number, exact:boolean}}
   *   perSide  — disques par côté (poids décroissants)
   *   achieved — poids total réellement chargeable (barre incluse)
   *   exact    — true si `total` est atteignable exactement
   */
  _computePlates(total, bar) {
    const barQ   = Math.round(bar * 4);
    const totalQ = Math.round(total * 4);
    let remaining = Math.max(0, Math.floor((totalQ - barQ) / 2));
    const perSide = [];
    for (const plate of PLATE_SET) {
      const plateQ = Math.round(plate * 4);
      const count  = Math.floor(remaining / plateQ);
      if (count > 0) {
        perSide.push({ weight: plate, count });
        remaining -= count * plateQ;
      }
    }
    const loadedQ  = perSide.reduce((sum, p) => sum + p.count * Math.round(p.weight * 4) * 2, barQ);
    const achieved = loadedQ / 4;
    return { perSide, achieved, exact: achieved === total };
  }

  /**
   * HTML du résultat : badges « n × p kg » par côté + mention si le poids
   * demandé n'est pas atteignable exactement. Uniquement des nombres et des
   * chaînes de locale — aucun texte utilisateur.
   */
  _buildPlateCalcResult(total, bar) {
    if (!(total > 0)) {
      return `<span class="plate-calc__placeholder">—</span>`;
    }
    const { perSide, achieved, exact } = this._computePlates(total, bar);
    const badges = perSide.length
      ? perSide.map(p => `<span class="plate-calc__badge">${p.count} × ${p.weight} kg</span>`).join('')
      : `<span class="plate-calc__badge plate-calc__badge--empty">${t('plates.empty_bar')}</span>`;
    const note = exact
      ? ''
      : `<p class="plate-calc__note">${t('plates.unreachable', { w: achieved })}</p>`;
    return `<div class="plate-calc__badges">${badges}</div>${note}`;
  }

  _openPlateCalc(exIdx) {
    const ex = this._session?.exercises[exIdx];

    // Préremplissage : poids de la dernière série renseignée (non-timer)
    let prefill = 0;
    if (ex) {
      for (let i = ex.sets.length - 1; i >= 0; i--) {
        const s = ex.sets[i];
        if (s.type !== 'timer' && s.weight > 0) { prefill = s.weight; break; }
      }
    }

    // Barre persistée : profile.settings.plateCalc.barWeight (défensif si absent)
    let barWeight = parseFloat(this._settings?.plateCalc?.barWeight);
    if (!BAR_OPTIONS.includes(barWeight)) barWeight = 20;

    const overlay = document.getElementById('modal-overlay');
    const barsHtml = BAR_OPTIONS.map(w => `
      <button class="plate-calc__bar${w === barWeight ? ' plate-calc__bar--active' : ''}"
              data-action="plate-bar" data-bar="${w}">${w} kg</button>`).join('');

    overlay.innerHTML = `
      <div class="modal plate-calc">
        <div class="modal__handle"></div>
        <div class="plate-calc__header">
          <h2 class="plate-calc__title">${t('plates.title')}</h2>
          <button class="btn btn--icon" data-action="close-plate-calc" aria-label="Fermer">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="plate-calc__body">
          <label class="plate-calc__label" for="plate-calc-weight">${t('plates.total')}</label>
          <input class="plate-calc__input" id="plate-calc-weight"
                 type="number" min="0" step="0.5" inputmode="decimal"
                 placeholder="—" value="${prefill > 0 ? prefill : ''}">
          <span class="plate-calc__label">${t('plates.bar')}</span>
          <div class="plate-calc__bars">${barsHtml}</div>
          <span class="plate-calc__label">${t('plates.per_side')}</span>
          <div class="plate-calc__result" id="plate-calc-result"></div>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    // Recalcul en direct — l'input vit dans le modal-overlay et disparaît
    // avec lui (_closeModal vide innerHTML) : aucun listener persistant.
    const update = () => {
      const resultEl = document.getElementById('plate-calc-result');
      if (!resultEl) return;
      const total = Math.max(0, parseFloat(document.getElementById('plate-calc-weight')?.value) || 0);
      resultEl.innerHTML = this._buildPlateCalcResult(total, barWeight);
    };
    update();
    overlay.querySelector('#plate-calc-weight')?.addEventListener('input', update);

    overlay.onclick = (e) => {
      if (e.target === overlay) { this._closeModal(); return; }
      const target = e.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'close-plate-calc') {
        this._closeModal();
      } else if (target.dataset.action === 'plate-bar') {
        const w = parseFloat(target.dataset.bar);
        if (!BAR_OPTIONS.includes(w)) return;
        barWeight = w;
        overlay.querySelectorAll('.plate-calc__bar').forEach(btn => {
          btn.classList.toggle('plate-calc__bar--active', parseFloat(btn.dataset.bar) === w);
        });
        update();
        this._savePlateCalcBar(w);
      }
    };
  }

  /** Persiste le choix de barre dans profile.settings.plateCalc.barWeight. */
  _savePlateCalcBar(weight) {
    this._settings.plateCalc = { ...(this._settings.plateCalc || {}), barWeight: weight };
    dbGetProfile()
      .then(profile => {
        if (!profile) return;
        profile.settings = profile.settings || {};
        profile.settings.plateCalc = { ...(profile.settings.plateCalc || {}), barWeight: weight };
        return dbSaveProfile(profile);
      })
      .catch(() => { /* persistance non bloquante */ });
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
        const q = normalize(search);
        exercises = exercises.filter(ex =>
          normalize(ex.name).includes(q)
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
        this._saveDraft();
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
    this._stopGlobalTimer();
    this._clearDraft();
    this._releaseWakeLock();
    setState('activeSession', null);
    this._session   = null;
    this._finishing = false;
    this._prevSets  = {};
    this._prHistory = {};
    this._basePRHistory = {};
    this._bar.classList.add('hidden');
    this._hide();
  }

  // ---------------------------------------------------------------------------
  // Finish session
  // ---------------------------------------------------------------------------

  async _finishSession() {
    // Garde de réentrance : évite le double-comptage (usageCount,
    // totalWorkouts) sur double-clic pendant les await.
    if (this._finishing || !this._session) return;
    this._finishing = true;

    this._stopTimer();
    this._stopRestTimerImmediate();
    this._stopGlobalTimer();

    // Réglage manageIncompleteSets : ask / keep / delete (cf. profil.js)
    const incompleteMode = this._settings.manageIncompleteSets || 'ask';
    const hasIncomplete  = this._session.exercises.some(ex => ex.sets.some(s => !s.completed));
    let discardIncomplete = false;
    if (hasIncomplete) {
      if (incompleteMode === 'delete') {
        discardIncomplete = true;
      } else if (incompleteMode === 'ask') {
        // confirm natif : OK = conserver, Annuler = retirer
        discardIncomplete = !window.confirm(t('session.incomplete_sets_prompt'));
      }
      // 'keep' → comportement actuel (on garde tout)
    }
    if (discardIncomplete) {
      for (const ex of this._session.exercises) {
        ex.sets = ex.sets.filter(s => s.completed);
      }
    }

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
            const e1rm = estimate1RM(set.weight, set.reps);
            if (e1rm > best1RM) {
              best1RM = e1rm;
              bestSet = {
                weight:       set.weight,
                reps:         set.reps,
                estimated1RM: e1rm,
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

      // Increment usageCount — uniquement si au moins une vraie série complétée
      const hasCompletedSet = ex.sets.some(s => s.completed && s.type !== 'timer');
      if (exercise && hasCompletedSet) {
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

    // La séance est sauvegardée : le brouillon n'a plus lieu d'être
    this._clearDraft();
    this._releaseWakeLock();

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
        this._finishing = false;
        this._prevSets  = {};
        this._prHistory = {};
        this._basePRHistory = {};
        this._elapsed   = 0;
        // Notify pages so they can refresh their data
        document.dispatchEvent(new CustomEvent('session-complete', { bubbles: true }));
      }
    };
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Touch gestures — swipe-to-delete + long-press reorder
  // ---------------------------------------------------------------------------

  _onTouchStart(e) {
    const touch = e.touches[0];
    this._swipeStartX = touch.clientX;
    this._swipeStartY = touch.clientY;
    this._swipeDir    = null;

    // Close revealed row if touch is outside its wrapper
    if (this._openSwipeRow) {
      const wrap = this._openSwipeRow.closest('.set-row-wrap');
      if (wrap && !wrap.contains(e.target)) this._closeOpenSwipeRow();
    }

    // Swipe-to-delete: track non-timer set rows
    const setRow = e.target.closest('.session-set-row:not(.session-set-row--timer)');
    this._swipeRow = setRow || null;

    // Long press: exercise name → reorder mode
    const exName = e.target.closest('.session-exercise__name');
    if (exName) {
      this._lpStartX = touch.clientX;
      this._lpStartY = touch.clientY;
      const exEl = exName.closest('.session-exercise');
      this._lpExIdx = exEl ? parseInt(exEl.id.replace('session-ex-', ''), 10) : 0;
      this._lpTimer = setTimeout(() => {
        this._lpTimer = null;
        this._showReorderMode(this._lpExIdx);
      }, 500);
    }
  }

  _onTouchMove(e) {
    const touch = e.touches[0];
    const dx = touch.clientX - this._swipeStartX;
    const dy = touch.clientY - this._swipeStartY;

    // Cancel long press on movement
    if (this._lpTimer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearTimeout(this._lpTimer);
      this._lpTimer = null;
    }

    // Reorder drag — takes priority while reorder view is active
    if (this._reorderActive && this._reorderDragging) {
      e.preventDefault();
      const container = document.getElementById('session-reorder');
      if (!container) return;
      const dragDy = touch.clientY - this._reorderStartY;
      this._reorderDragging.style.transform = `translateY(${dragDy}px)`;

      // Determine target index from finger position.
      // Basé sur les milieux capturés au début du drag (positions stables,
      // insensibles aux translateY d'animation). Cible = nombre d'items
      // (hors item déplacé) dont le milieu est au-dessus du doigt : si le
      // doigt est au-dessus du milieu du premier item, la cible vaut 0.
      const containerTop = container.getBoundingClientRect().top;
      const fingerY      = touch.clientY - containerTop;
      const items        = [...container.querySelectorAll('.session-reorder__item')];
      let   newTarget    = 0;
      for (let i = 0; i < this._reorderMids.length; i++) {
        if (i === this._reorderStartIdx) continue;
        if (fingerY > this._reorderMids[i]) newTarget++;
      }
      if (newTarget !== this._reorderTargetIdx) {
        this._reorderTargetIdx = newTarget;
        const h = this._reorderDragging.offsetHeight;
        items.forEach((it, i) => {
          if (it === this._reorderDragging) return;
          let shift = 0;
          if (this._reorderStartIdx < newTarget && i > this._reorderStartIdx && i <= newTarget)      shift = -h;
          else if (this._reorderStartIdx > newTarget && i >= newTarget && i < this._reorderStartIdx) shift = h;
          it.style.transition = 'transform 0.15s';
          it.style.transform  = shift ? `translateY(${shift}px)` : '';
        });
      }
      return;
    }

    if (!this._swipeRow) return;

    // Determine direction on first significant movement
    if (this._swipeDir === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      this._swipeDir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (this._swipeDir !== 'h') return;

    e.preventDefault(); // block scroll while swiping horizontally

    const isOpen = this._openSwipeRow === this._swipeRow;
    if (dx < 0) {
      // Swipe left — clamp to delete-button width
      const clamped = Math.max(dx, -72);
      this._swipeRow.style.transition = 'none';
      this._swipeRow.style.transform  = `translateX(${clamped}px)`;
    } else if (dx > 0 && isOpen) {
      // Swipe right to close
      const clamped = Math.min(dx - 72, 0);
      this._swipeRow.style.transition = 'none';
      this._swipeRow.style.transform  = `translateX(${clamped}px)`;
    }
  }

  _onTouchEnd(e) {
    clearTimeout(this._lpTimer);
    this._lpTimer = null;

    // Reorder: finger lifted → commit order and return to normal view
    if (this._reorderActive) {
      this._reorderActive = false;
      const from = this._reorderStartIdx;
      const to   = this._reorderTargetIdx;
      this._reorderDragging = null;
      if (from !== to) {
        const [moved] = this._session.exercises.splice(from, 1);
        this._session.exercises.splice(to, 0, moved);
        this._saveDraft();
      }
      this._render();
      return;
    }

    if (this._swipeRow && this._swipeDir === 'h') {
      const dx = e.changedTouches[0].clientX - this._swipeStartX;
      const isOpen = this._openSwipeRow === this._swipeRow;
      if (dx < -40) {
        // Snap to revealed
        this._swipeRow.style.transition = 'transform 0.2s';
        this._swipeRow.style.transform  = 'translateX(-72px)';
        if (this._openSwipeRow && this._openSwipeRow !== this._swipeRow) this._closeOpenSwipeRow();
        this._openSwipeRow = this._swipeRow;
        const eIdx = parseInt(this._swipeRow.dataset.exIdx, 10);
        const sIdx = parseInt(this._swipeRow.dataset.si, 10);
        this._requestDeleteSet(eIdx, sIdx);
      } else if (dx > 20 && isOpen) {
        this._closeOpenSwipeRow();
      } else if (!isOpen) {
        // Snap back
        this._swipeRow.style.transition = 'transform 0.2s';
        this._swipeRow.style.transform  = 'translateX(0)';
      }
    }
    this._swipeRow  = null;
    this._swipeDir  = null;
  }

  _onTouchCancel(e) {
    clearTimeout(this._lpTimer);
    this._lpTimer = null;

    // Reorder: touch cancelled → discard order change and return to normal view
    if (this._reorderActive) {
      this._reorderActive   = false;
      this._reorderDragging = null;
      this._render();
      return;
    }

    if (this._swipeRow) {
      this._swipeRow.style.transition = 'transform 0.2s';
      this._swipeRow.style.transform  = 'translateX(0)';
      this._swipeRow = null;
    }
    this._swipeDir = null;
  }

  _closeOpenSwipeRow() {
    if (!this._openSwipeRow) return;
    this._openSwipeRow.style.transition = 'transform 0.2s';
    this._openSwipeRow.style.transform  = 'translateX(0)';
    this._openSwipeRow = null;
  }

  _showDeleteConfirmation(exIdx, si) {
    document.getElementById('session-delete-confirm')?.remove();
    const el = document.createElement('div');
    el.id             = 'session-delete-confirm';
    el.className      = 'delete-confirm-backdrop';
    el.dataset.action = 'cancel-delete'; // tap backdrop = annuler
    el.innerHTML = `
      <div class="delete-confirm__dialog">
        <p class="delete-confirm__text">Supprimer la série&nbsp;?</p>
        <div class="delete-confirm__actions">
          <button class="delete-confirm__btn delete-confirm__btn--cancel"
                  data-action="cancel-delete">ANNULER</button>
          <button class="delete-confirm__btn delete-confirm__btn--confirm"
                  data-action="confirm-delete"
                  data-ex-idx="${exIdx}" data-si="${si}">SUPPRIMER</button>
        </div>
      </div>`;
    this._overlay.appendChild(el);
  }

  // ---------------------------------------------------------------------------
  // Reorder mode — long press on exercise name → drag-to-sort
  // ---------------------------------------------------------------------------

  _showReorderMode(lpExIdx) {
    navigator.vibrate?.(50);
    const itemsHtml = this._session.exercises.map((ex, i) => {
      const exercise = this._getExercise(ex.exerciseId);
      const name     = exercise ? exercise.name : (ex.exerciseName || '?');
      const color    = colorForId(ex.exerciseId);
      const initial  = name.trim().charAt(0).toUpperCase();
      return `
        <div class="session-reorder__item" data-ex-idx="${i}">
          <div class="session-exercise__icon" style="background:${color}22;color:${color};">${initial}</div>
          <span class="session-reorder__name">${escapeHtml(name)}</span>
          <i class="fa-solid fa-grip-lines session-reorder__grip"></i>
        </div>`;
    }).join('');

    this._overlay.innerHTML = `
      <div class="session">
        <div class="session__header">
          <button class="btn btn--icon session__btn-minimize" data-action="minimize" aria-label="Réduire">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <button class="session__btn-timer${this._globalInterval ? ' session__btn-timer--running' : ''}" data-action="open-timer-modal" aria-label="Minuteur de repos">
            <i class="fa-regular fa-stopwatch fa-lg"></i>${this._globalInterval ? ` ${this._formatRestTime(this._globalRemaining)}` : ''}
          </button>
          <span class="session__timer" id="session-timer">${this._formatElapsed(this._elapsed)}</span>
          <button class="session__btn-finish" data-action="finish">${t('session.finish')}</button>
        </div>
        <div class="session-reorder" id="session-reorder">${itemsHtml}</div>
      </div>`;

    // Immediately start dragging the long-pressed exercise — drag follows finger
    // until touchend/touchcancel, at which point the order is committed and
    // the normal view is restored.
    const container = document.getElementById('session-reorder');
    if (!container) return;
    const items = [...container.querySelectorAll('.session-reorder__item')];
    const item  = items[lpExIdx];
    if (!item) return;

    this._reorderActive    = true;
    this._reorderDragging  = item;
    this._reorderStartY    = this._lpStartY;
    this._reorderStartIdx  = lpExIdx;
    this._reorderTargetIdx = lpExIdx;
    // Capture les milieux des items AVANT toute translation d'animation :
    // positions de référence stables pour le calcul de la cible du drag.
    const containerTop = container.getBoundingClientRect().top;
    this._reorderMids = items.map(it =>
      it.getBoundingClientRect().top + it.offsetHeight / 2 - containerTop
    );
    item.classList.add('session-reorder__item--dragging');
  }

  // Timer modal — modale plein écran (image 7 : choix durée / image 8 : décompte)
  // Entièrement indépendant du timer inline (_restInterval).
  // ---------------------------------------------------------------------------

  _startGlobalTimer(seconds) {
    if (this._globalInterval) {
      clearInterval(this._globalInterval);
      this._globalInterval = null;
    }
    // Annule le nettoyage différé d'un timer précédent (course de timers)
    clearTimeout(this._globalDoneTimeout);
    this._globalDoneTimeout = null;
    this._globalTotal     = seconds;
    this._globalEndsAt    = Date.now() + seconds * 1000;
    this._globalRemaining = seconds;
    this._globalInterval  = setInterval(() => this._tickGlobalTimer(), 1000);
    this._updateTimerBtn();
  }

  _stopGlobalTimer() {
    if (this._globalInterval) {
      clearInterval(this._globalInterval);
      this._globalInterval = null;
    }
    clearTimeout(this._globalDoneTimeout);
    this._globalDoneTimeout = null;
    this._globalRemaining = 0;
    this._globalTotal     = 0;
    this._globalEndsAt    = 0;
    document.getElementById('session-timer-modal')?.remove();
    this._updateTimerBtn();
  }

  _tickGlobalTimer() {
    // Restant recalculé depuis le timestamp de fin (fiable en arrière-plan)
    this._globalRemaining = Math.max(0, Math.ceil((this._globalEndsAt - Date.now()) / 1000));
    if (this._globalRemaining <= 0) {
      clearInterval(this._globalInterval);
      this._globalInterval = null;
      this._updateGlobalTimerModal();
      this._updateTimerBtn();
      navigator.vibrate?.([200, 100, 200]);
      this._playBeep(2);
      document.getElementById('session-timer-modal')?.classList.add('timer-modal--done');
      clearTimeout(this._globalDoneTimeout);
      this._globalDoneTimeout = setTimeout(() => {
        this._globalDoneTimeout = null;
        this._globalRemaining = 0;
        this._globalTotal     = 0;
        this._globalEndsAt    = 0;
        document.getElementById('session-timer-modal')?.remove();
        this._updateTimerBtn();
      }, 2500);
      return;
    }
    this._updateGlobalTimerModal();
    this._updateTimerBtn();
  }

  _updateTimerBtn() {
    const btn = this._overlay.querySelector('[data-action="open-timer-modal"]');
    if (!btn) return;
    if (this._globalInterval || this._globalRemaining > 0) {
      btn.className = 'session__btn-timer session__btn-timer--running';
      btn.innerHTML = `<i class="fa-regular fa-stopwatch fa-lg"></i> ${this._formatRestTime(this._globalRemaining)}`;
    } else {
      btn.className = 'session__btn-timer';
      btn.innerHTML = `<i class="fa-regular fa-stopwatch fa-lg"></i>`;
    }
  }

  _showTimerModal() {
    document.getElementById('session-timer-modal')?.remove();
    const isRunning = !!this._globalInterval || this._globalRemaining > 0;
    const modal = document.createElement('div');
    modal.id        = 'session-timer-modal';
    modal.className = 'timer-modal';
    modal.innerHTML = isRunning ? this._buildTimerModalRunning() : this._buildTimerModalIdle();
    this._overlay.appendChild(modal);
  }

  _buildTimerModalIdle() {
    return `
      <div class="timer-modal__header">
        <button class="timer-modal__close" data-action="timer-modal-close"><i class="fa-solid fa-xmark"></i></button>
        <span class="timer-modal__title">Minuteur de repos</span>
        <i class="fa-regular fa-circle-question timer-modal__help"></i>
      </div>
      <p class="timer-modal__hint">Choisissez l'une des durées ci-dessous ou définissez votre propre durée. Les durées personnalisées sont enregistrées pour la prochaine fois.</p>
      <div class="timer-modal__ring-wrap">
        <svg class="timer-modal__svg" viewBox="0 0 220 220">
          <circle class="timer-modal__track" cx="110" cy="110" r="100"/>
        </svg>
        <div class="timer-modal__presets">
          <button class="timer-modal__preset" data-action="timer-preset" data-seconds="60">1:00</button>
          <button class="timer-modal__preset" data-action="timer-preset" data-seconds="120">2:00</button>
          <button class="timer-modal__preset" data-action="timer-preset" data-seconds="180">3:00</button>
          <button class="timer-modal__preset" data-action="timer-preset" data-seconds="240">4:00</button>
        </div>
      </div>
      <button class="timer-modal__custom-btn" data-action="timer-custom">CRÉER UN MINUTEUR PERSONNALISÉ</button>`;
  }

  _buildTimerModalRunning() {
    const circ   = 628.32;
    const offset = this._globalTotal > 0
      ? (circ * (1 - this._globalRemaining / this._globalTotal)).toFixed(1)
      : '0';
    return `
      <div class="timer-modal__header">
        <button class="timer-modal__close" data-action="timer-modal-close"><i class="fa-solid fa-xmark"></i></button>
        <span class="timer-modal__title">Minuteur de repos</span>
        <i class="fa-regular fa-circle-question timer-modal__help"></i>
      </div>
      <p class="timer-modal__hint">Ajustez la durée avec les boutons +/-.</p>
      <div class="timer-modal__ring-wrap">
        <svg class="timer-modal__svg" viewBox="0 0 220 220">
          <circle class="timer-modal__track" cx="110" cy="110" r="100"/>
          <circle class="timer-modal__progress" id="timer-modal-progress" cx="110" cy="110" r="100"
                  stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
                  transform="rotate(-90 110 110)"/>
        </svg>
        <div class="timer-modal__countdown">
          <span class="timer-modal__time" id="timer-modal-time">${this._formatRestTime(this._globalRemaining)}</span>
          <span class="timer-modal__total">${this._formatRestTime(this._globalTotal)}</span>
        </div>
      </div>
      <div class="timer-modal__actions">
        <button class="timer-modal__adj" data-action="timer-adjust" data-delta="-30">- 30 S</button>
        <button class="timer-modal__adj" data-action="timer-adjust" data-delta="30">+ 30 S</button>
        <button class="timer-modal__skip" data-action="timer-skip">IGNORER</button>
      </div>`;
  }

  _updateGlobalTimerModal() {
    const timeEl = document.getElementById('timer-modal-time');
    const progEl = document.getElementById('timer-modal-progress');
    if (!timeEl && !progEl) return;
    if (timeEl) timeEl.textContent = this._formatRestTime(this._globalRemaining);
    if (progEl) {
      const circ   = 628.32;
      const offset = this._globalTotal > 0
        ? (circ * (1 - this._globalRemaining / this._globalTotal)).toFixed(1)
        : '0';
      progEl.style.strokeDashoffset = offset;
    }
  }

  // ---------------------------------------------------------------------------
  // Rest timer — barre inline dans le bloc exercice
  // ---------------------------------------------------------------------------

  _startRestTimer(seconds, exIdx, si = null) {
    this._stopRestTimerImmediate();
    // Références d'objets (pas d'index bruts) : insensibles aux splice /
    // réordonnancements survenant pendant le repos.
    this._restEx  = (exIdx != null && this._session) ? (this._session.exercises[exIdx] ?? null) : null;
    this._restSet = (si !== null && this._restEx)    ? (this._restEx.sets[si] ?? null)          : null;
    this._restTotal     = seconds;
    this._restEndsAt    = Date.now() + seconds * 1000;
    this._restRemaining = seconds;
    this._restInterval  = setInterval(() => this._tickRestTimer(), 1000);
    this._insertRestTimerBar();
  }

  /** Index courants (live) de l'exercice/set du repos. -1 si supprimés. */
  _restIndices() {
    const exIdx = (this._session && this._restEx)
      ? this._session.exercises.indexOf(this._restEx)
      : -1;
    const si = (exIdx !== -1 && this._restSet)
      ? this._restEx.sets.indexOf(this._restSet)
      : -1;
    return { exIdx, si };
  }

  /** Suppression immédiate (bouton Ignorer) — réaffiche la ligne timer en idle */
  _stopRestTimer() {
    if (this._restInterval) {
      clearInterval(this._restInterval);
      this._restInterval = null;
    }
    clearTimeout(this._restDoneTimeout);
    this._restDoneTimeout = null;
    const { exIdx } = this._restIndices();
    this._restRemaining = 0;
    this._restTotal     = 0;
    this._restEndsAt    = 0;
    this._restEx        = null;
    this._restSet       = null;
    document.getElementById('session-rest-timer')?.remove();
    if (exIdx !== -1) this._reRenderSetsSection(exIdx);
  }

  /** Suppression instantanée (annulation / fin de séance) */
  _stopRestTimerImmediate() {
    if (this._restInterval) {
      clearInterval(this._restInterval);
      this._restInterval = null;
    }
    clearTimeout(this._restDoneTimeout);
    this._restDoneTimeout = null;
    this._restRemaining = 0;
    this._restTotal     = 0;
    this._restEndsAt    = 0;
    this._restEx        = null;
    this._restSet       = null;
    document.getElementById('session-rest-timer')?.remove();
  }

  _tickRestTimer() {
    // Restant recalculé depuis le timestamp de fin (fiable en arrière-plan)
    this._restRemaining = Math.max(0, Math.ceil((this._restEndsAt - Date.now()) / 1000));
    if (this._restRemaining <= 0) {
      clearInterval(this._restInterval);
      this._restInterval = null;
      this._updateRestTimerDisplay();
      navigator.vibrate?.([200, 100, 200]);
      this._playBeep(2);

      // Mark the timer set as completed (référence directe, index-safe)
      if (this._restSet?.type === 'timer') {
        this._restSet.completed = true;
        this._saveDraft();
      }

      const el = document.getElementById('session-rest-timer');
      if (el) el.classList.add('session-rest-bar--done');

      // After 2.5 s, replace bar with the done row — annulable si un
      // nouveau timer démarre entre-temps (course de timers).
      clearTimeout(this._restDoneTimeout);
      this._restDoneTimeout = setTimeout(() => {
        this._restDoneTimeout = null;
        const { exIdx } = this._restIndices();
        this._restEx        = null;
        this._restSet       = null;
        this._restRemaining = 0;
        this._restTotal     = 0;
        this._restEndsAt    = 0;
        document.getElementById('session-rest-timer')?.remove();
        if (exIdx !== -1) this._reRenderSetsSection(exIdx);
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
    if (!this._restEx) return;
    const { exIdx, si } = this._restIndices();
    if (exIdx === -1) {
      // L'exercice a été supprimé pendant le repos → arrêt propre
      this._stopRestTimerImmediate();
      return;
    }

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
    const timerRow = si !== -1
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
  // Screen Wake Lock — écran allumé pendant la séance en plein écran
  // ---------------------------------------------------------------------------

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) return; // API non supportée partout
    if (this._wakeLock) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      // Libéré par le navigateur (onglet en arrière-plan) → réinitialise le
      // sentinel ; la ré-acquisition se fait sur visibilitychange.
      this._wakeLock.addEventListener('release', () => {
        this._wakeLock = null;
      });
    } catch {
      this._wakeLock = null;
    }
  }

  _releaseWakeLock() {
    try {
      this._wakeLock?.release();
    } catch { /* déjà libéré */ }
    this._wakeLock = null;
  }

  // ---------------------------------------------------------------------------
  // Sound effects — bip discret (WebAudio, oscillateur court, aucun fichier)
  // ---------------------------------------------------------------------------

  _playBeep(times = 1) {
    if (!this._settings.soundEffects) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!this._audioCtx) this._audioCtx = new Ctx();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      for (let i = 0; i < times; i++) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0   = ctx.currentTime + i * 0.18;
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.15);
      }
    } catch { /* audio indisponible — non bloquant */ }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _getExercise(id) {
    return this._exercises.find(ex => ex.id === id);
  }

  /** Nettoyage complet (listeners globaux, timers, wake lock). */
  destroy() {
    this._stopTimer();
    this._stopRestTimerImmediate();
    this._stopGlobalTimer();
    clearTimeout(this._hideTimeout);
    this._hideTimeout = null;
    clearTimeout(this._draftTimeout);
    this._draftTimeout = null;
    this._releaseWakeLock();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
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
