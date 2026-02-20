import { t } from '../i18n.js';
import { uid } from '../utils/helpers.js';
import {
  dbGetAllExercises,
  dbPutExercise,
  dbDelete,
  dbGetByIndex,
} from '../db.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'barbell',     key: 'cat.barbell'     },
  { value: 'dumbbell',    key: 'cat.dumbbell'    },
  { value: 'machine',     key: 'cat.machine'     },
  { value: 'bodyweight',  key: 'cat.bodyweight'  },
  { value: 'assisted_bw', key: 'cat.assisted_bw' },
  { value: 'reps_only',   key: 'cat.reps_only'   },
  { value: 'cardio',      key: 'cat.cardio'      },
  { value: 'duration',    key: 'cat.duration'    },
];

const MUSCLE_GROUPS = [
  { value: 'chest',     key: 'muscle.chest'     },
  { value: 'back',      key: 'muscle.back'      },
  { value: 'shoulders', key: 'muscle.shoulders' },
  { value: 'biceps',    key: 'muscle.biceps'    },
  { value: 'triceps',   key: 'muscle.triceps'   },
  { value: 'forearms',  key: 'muscle.forearms'  },
  { value: 'legs',      key: 'muscle.legs'      },
  { value: 'glutes',    key: 'muscle.glutes'    },
  { value: 'core',      key: 'muscle.core'      },
  { value: 'full_body', key: 'muscle.full_body' },
  { value: 'cardio',    key: 'muscle.cardio'    },
  { value: 'other',     key: 'muscle.other'     },
];

const MUSCLE_NONE = { value: '', key: 'muscle.none' };

/** Palette de couleurs pour les icônes initiales */
const ICON_COLORS = [
  '#7c5cbf', '#4caf7d', '#e55353', '#f0a030',
  '#3b9dd4', '#e0609a', '#5bae8f', '#d4873b',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise une chaîne : minuscules, sans accents.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Retourne une couleur déterministe pour un exercice.
 * @param {string} id
 * @returns {string}
 */
function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ICON_COLORS[hash % ICON_COLORS.length];
}

/**
 * Retourne la première lettre majuscule du nom (insensible aux accents).
 * @param {string} name
 * @returns {string}
 */
function groupLetter(name) {
  const first = name.trim().charAt(0).toUpperCase();
  // Si c'est un caractère accentué, normaliser
  return first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() || '#';
}

/**
 * Trie un tableau d'exercices selon le mode de tri.
 * @param {object[]} exercises
 * @param {'az'|'za'|'usage'} sortMode
 * @returns {object[]}
 */
function sortExercises(exercises, sortMode) {
  return [...exercises].sort((a, b) => {
    if (sortMode === 'usage') {
      const diff = (b.usageCount || 0) - (a.usageCount || 0);
      if (diff !== 0) return diff;
    }
    if (sortMode === 'za') {
      return b.name.localeCompare(a.name, 'fr', { sensitivity: 'base' });
    }
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });
}

// ── Classe principale ─────────────────────────────────────────────────────────

export default class ExercicesPage {
  constructor(container) {
    this.container = container;

    // État interne
    this._exercises    = [];   // tous les exercices chargés
    this._searchQuery  = '';
    this._filterMuscle = '';   // '' = pas de filtre
    this._sortMode     = 'az'; // 'az' | 'za' | 'usage'
    this._showArchives = false;
    this._searchOpen   = false;

    // Timers & refs pour long press
    this._longPressTimer = null;
    this._longPressTarget = null;

    // Listeners attachés au document / window (pour destroy)
    this._handlers = {};
  }

  // ── Point d'entrée ──────────────────────────────────────────────────────────

  async render() {
    this.container.innerHTML = this._buildShell();
    this._bindEvents();
    await this._loadAndRender();
  }

  destroy() {
    // Retirer les listeners globaux
    if (this._handlers.docClick) {
      document.removeEventListener('click', this._handlers.docClick);
    }
    if (this._handlers.docKeydown) {
      document.removeEventListener('keydown', this._handlers.docKeydown);
    }
    // Fermer toute modale ouverte
    this._closeModal();
    // Nettoyer le timer de long press
    clearTimeout(this._longPressTimer);
  }

  // ── Shell HTML ───────────────────────────────────────────────────────────────

  _buildShell() {
    return `
      <div class="page" id="ex-page">
        <div class="page-header" id="ex-header" style="position:relative;">
          <h1 class="page-title" id="ex-title">${t('exercises.title')}</h1>
          <div class="search-bar" id="ex-search-bar">
            <input
              type="search"
              class="search-bar__input"
              id="ex-search-input"
              placeholder="${t('exercises.search_ph')}"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
            >
            <button class="btn btn--icon search-bar__close" id="ex-search-close" aria-label="${t('action.close')}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="page-actions" id="ex-actions">
            <button class="btn btn--icon" id="ex-btn-search" aria-label="${t('action.search')}">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
            <button class="btn btn--icon" id="ex-btn-filter" aria-label="${t('action.filter')}">
              <i class="fa-solid fa-sliders"></i>
            </button>
            <span id="ex-filter-badge" class="filter-badge hidden"></span>
            <button class="btn btn--icon" id="ex-btn-sort" aria-label="${t('action.sort')}">
              <i class="fa-solid fa-arrow-up-arrow-down"></i>
            </button>
            <div class="page-actions__menu" style="position:relative;">
              <button class="btn btn--icon" id="ex-btn-menu" aria-label="Plus">
                <i class="fa-solid fa-ellipsis-vertical"></i>
              </button>
              <div class="context-menu hidden" id="ex-context-menu">
                <div class="context-menu__item" data-action="create-exercise">
                  <i class="fa-solid fa-plus"></i>
                  ${t('exercises.create')}
                </div>
                <div class="context-menu__item" data-action="toggle-archives" id="ex-menu-archives-item">
                  <i class="fa-solid fa-box-archive"></i>
                  ${t('exercises.archives')}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div id="ex-list-container"></div>
      </div>`;
  }

  // ── Chargement et rendu de la liste ──────────────────────────────────────────

  async _loadAndRender() {
    this._exercises = await dbGetAllExercises();
    this._renderList();
  }

  _renderList() {
    const container = document.getElementById('ex-list-container');
    if (!container) return;

    let exercises = this._showArchives
      ? this._exercises.filter(ex => ex.isArchived === true)
      : this._exercises.filter(ex => !ex.isArchived);

    // Filtre par groupe musculaire
    if (this._filterMuscle) {
      exercises = exercises.filter(ex => ex.muscleGroup === this._filterMuscle);
    }

    // Filtre par recherche
    if (this._searchQuery) {
      const q = normalize(this._searchQuery);
      exercises = exercises.filter(ex => normalize(ex.name).includes(q));
    }

    // Tri
    exercises = sortExercises(exercises, this._sortMode);

    // Mise à jour du badge filtre
    this._updateFilterBadge();

    // Mise à jour du label archives dans le menu
    const archivesItem = document.getElementById('ex-menu-archives-item');
    if (archivesItem) {
      archivesItem.innerHTML = `
        <i class="fa-solid fa-box-archive"></i>
        ${this._showArchives ? t('exercises.archives_title') + ' ✓' : t('exercises.archives')}`;
    }

    if (exercises.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-dumbbell empty-state__icon"></i>
          <p class="empty-state__title">${t('exercises.empty_search')}</p>
          <p class="empty-state__text">${this._searchQuery ? normalize(this._searchQuery) : ''}</p>
        </div>`;
      return;
    }

    // Affichage : plat si recherche active, sinon groupé par lettre
    if (this._searchQuery) {
      container.innerHTML = `
        <div class="exercises-list">
          <div class="exercises-group">
            <div class="exercises-group__items">
              ${exercises.map(ex => this._buildExerciseItem(ex)).join('')}
            </div>
          </div>
        </div>`;
    } else {
      // Grouper par lettre
      const groups = new Map();
      for (const ex of exercises) {
        const letter = groupLetter(ex.name);
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(ex);
      }

      const groupsHtml = [...groups.entries()].map(([letter, items]) => `
        <div class="exercises-group">
          <div class="exercises-group__letter">${letter}</div>
          <div class="exercises-group__items">
            ${items.map(ex => this._buildExerciseItem(ex)).join('')}
          </div>
        </div>`).join('');

      container.innerHTML = `<div class="exercises-list">${groupsHtml}</div>`;
    }
  }

  _buildExerciseItem(ex) {
    const initial = ex.name.trim().charAt(0).toUpperCase();
    const color   = colorForId(ex.id);
    const muscle  = ex.muscleGroup ? t(`muscle.${ex.muscleGroup}`) : '';
    const countHtml = (ex.usageCount && ex.usageCount > 0)
      ? `<span class="exercise-item__count badge badge--accent">${ex.usageCount}</span>`
      : '';
    const archivedClass = ex.isArchived ? ' exercise-item--archived' : '';

    return `
      <div
        class="exercise-item${archivedClass}"
        data-id="${ex.id}"
        data-action="open-exercise"
      >
        <div class="exercise-item__icon" style="background:${color}22;color:${color};">
          ${initial}
        </div>
        <div class="exercise-item__body">
          <div class="exercise-item__name">${ex.name}</div>
          <div class="exercise-item__meta">${muscle}</div>
        </div>
        ${countHtml}
        <i class="fa-solid fa-chevron-right exercise-item__arrow" style="color:var(--text-disabled);font-size:12px;flex-shrink:0;"></i>
      </div>`;
  }

  // ── Badge filtre ─────────────────────────────────────────────────────────────

  _updateFilterBadge() {
    const badge = document.getElementById('ex-filter-badge');
    if (!badge) return;
    if (this._filterMuscle) {
      const label = t(`muscle.${this._filterMuscle}`);
      badge.innerHTML = `${label} <button class="filter-badge__clear" data-action="clear-filter" aria-label="${t('action.close')}"><i class="fa-solid fa-xmark"></i></button>`;
      badge.classList.remove('hidden');
    } else {
      badge.innerHTML = '';
      badge.classList.add('hidden');
    }
  }

  // ── Binding des événements ───────────────────────────────────────────────────

  _bindEvents() {
    // Délégation principale sur le container
    this._handlers.containerClick = (e) => this._onContainerClick(e);
    this.container.addEventListener('click', this._handlers.containerClick);

    // Fermer le menu contextuel en cliquant ailleurs
    this._handlers.docClick = (e) => {
      const menu = document.getElementById('ex-context-menu');
      if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(e.target) && !e.target.closest('#ex-btn-menu')) {
          menu.classList.add('hidden');
        }
      }
    };
    document.addEventListener('click', this._handlers.docClick);

    // Touche Echap
    this._handlers.docKeydown = (e) => {
      if (e.key === 'Escape') {
        this._closeModal();
        if (this._searchOpen) this._closeSearch();
      }
    };
    document.addEventListener('keydown', this._handlers.docKeydown);

    // Recherche (input)
    this.container.addEventListener('input', (e) => {
      if (e.target.id === 'ex-search-input') {
        this._searchQuery = e.target.value.trim();
        this._renderList();
      }
    });

    // Long press pour archiver
    this.container.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.container.addEventListener('pointerup',   (e) => this._onPointerUp(e));
    this.container.addEventListener('pointercancel', () => clearTimeout(this._longPressTimer));
    this.container.addEventListener('pointermove',  (e) => {
      // Annuler si le doigt se déplace trop
      clearTimeout(this._longPressTimer);
    });
  }

  // ── Gestionnaire de clic principal (délégation) ──────────────────────────────

  _onContainerClick(e) {
    // Boutons du header identifiés par leur ID
    if (e.target.closest('#ex-btn-search')) {
      this._openSearch();
      return;
    }
    if (e.target.closest('#ex-search-close')) {
      this._closeSearch();
      return;
    }
    if (e.target.closest('#ex-btn-filter')) {
      this._openFilterPicker();
      return;
    }
    if (e.target.closest('#ex-btn-sort')) {
      this._openSortPicker();
      return;
    }
    if (e.target.closest('#ex-btn-menu')) {
      this._toggleContextMenu();
      return;
    }

    // Délégation par data-action pour les éléments de la liste et du menu
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
      case 'open-exercise':
        // Comportement extensible (ex : naviguer vers la fiche détail)
        break;
      case 'clear-filter':
        e.stopPropagation();
        this._filterMuscle = '';
        this._renderList();
        break;
      case 'create-exercise':
        document.getElementById('ex-context-menu')?.classList.add('hidden');
        this._openCreateForm();
        break;
      case 'toggle-archives':
        document.getElementById('ex-context-menu')?.classList.add('hidden');
        this._showArchives = !this._showArchives;
        this._renderList();
        break;
      case 'archive-exercise':
        this._archiveExercise(target.dataset.id, true);
        break;
      case 'restore-exercise':
        this._archiveExercise(target.dataset.id, false);
        break;
      case 'delete-exercise':
        this._deleteExercise(target.dataset.id);
        break;
    }
  }

  // ── Recherche ────────────────────────────────────────────────────────────────

  _openSearch() {
    this._searchOpen = true;
    const title   = document.getElementById('ex-title');
    const actions = document.getElementById('ex-actions');
    const bar     = document.getElementById('ex-search-bar');
    if (title)   title.classList.add('hidden');
    if (actions) actions.classList.add('hidden');
    if (bar)     bar.classList.add('search-bar--open');
    const input = document.getElementById('ex-search-input');
    if (input)   input.focus();
  }

  _closeSearch() {
    this._searchOpen   = false;
    this._searchQuery  = '';
    const title   = document.getElementById('ex-title');
    const actions = document.getElementById('ex-actions');
    const bar     = document.getElementById('ex-search-bar');
    const input   = document.getElementById('ex-search-input');
    if (title)   title.classList.remove('hidden');
    if (actions) actions.classList.remove('hidden');
    if (bar)     bar.classList.remove('search-bar--open');
    if (input)   input.value = '';
    this._renderList();
  }

  // ── Menu contextuel ──────────────────────────────────────────────────────────

  _toggleContextMenu() {
    const menu = document.getElementById('ex-context-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  }

  // ── Picker filtre ────────────────────────────────────────────────────────────

  _openFilterPicker() {
    const options = [MUSCLE_NONE, ...MUSCLE_GROUPS].map(mg => `
      <div class="picker-option${this._filterMuscle === mg.value ? ' picker-option--selected' : ''}"
           data-action="pick-filter"
           data-value="${mg.value}">
        <span class="picker-option__label">${t(mg.key)}</span>
        ${this._filterMuscle === mg.value
          ? '<i class="fa-solid fa-check picker-option__check"></i>'
          : ''}
      </div>`).join('');

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal picker-modal">
        <div class="modal__handle"></div>
        <div class="modal__title">${t('exercises.muscle_group')}</div>
        <div class="picker-modal__options">
          ${options}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      const opt = e.target.closest('[data-action="pick-filter"]');
      if (opt) {
        this._filterMuscle = opt.dataset.value;
        this._closeModal();
        this._renderList();
        return;
      }
      if (e.target === overlay) this._closeModal();
    };
  }

  // ── Picker tri ───────────────────────────────────────────────────────────────

  _openSortPicker() {
    const sortLabels = {
      az:    'A \u2192 Z',
      za:    'Z \u2192 A',
      usage: 'Plus utilisé',
    };

    const options = Object.entries(sortLabels).map(([value, label]) => `
      <div class="picker-option${this._sortMode === value ? ' picker-option--selected' : ''}"
           data-action="pick-sort"
           data-value="${value}">
        <span class="picker-option__label">${label}</span>
        ${this._sortMode === value
          ? '<i class="fa-solid fa-check picker-option__check"></i>'
          : ''}
      </div>`).join('');

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal picker-modal">
        <div class="modal__handle"></div>
        <div class="modal__title">${t('action.sort')}</div>
        <div class="picker-modal__options">
          ${options}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      const opt = e.target.closest('[data-action="pick-sort"]');
      if (opt) {
        this._sortMode = opt.dataset.value;
        this._closeModal();
        this._renderList();
        return;
      }
      if (e.target === overlay) this._closeModal();
    };
  }

  // ── Formulaire de création ────────────────────────────────────────────────────

  _openCreateForm() {
    // État du formulaire
    let formName     = '';
    let formCategory = 'barbell';
    let formMuscle   = '';

    const renderForm = () => {
      const overlay = document.getElementById('modal-overlay');
      const catLabel    = t(`cat.${formCategory}`);
      const muscleLabel = formMuscle ? t(`muscle.${formMuscle}`) : t('muscle.none');
      const saveDisabled = !formName.trim() ? 'disabled' : '';

      overlay.innerHTML = `
        <div class="modal exercise-form" id="ex-create-modal">
          <div class="exercise-form__header">
            <button class="btn btn--ghost" data-action="form-cancel">
              <i class="fa-solid fa-xmark"></i> ${t('action.cancel')}
            </button>
            <span class="modal__title" style="margin:0;font-size:var(--text-lg);">${t('exercises.new_title')}</span>
            <button class="btn btn--ghost" data-action="form-save" ${saveDisabled}>
              <i class="fa-solid fa-check"></i> ${t('action.save')}
            </button>
          </div>
          <div class="exercise-form__body">
            <div class="input-group">
              <label class="input-label" for="ex-form-name">${t('exercises.name')}</label>
              <input
                class="input"
                id="ex-form-name"
                type="text"
                placeholder="${t('exercises.name_ph')}"
                value="${escapeHtml(formName)}"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
              >
            </div>
            <div class="input-group" style="margin-top:var(--space-4);">
              <label class="input-label">${t('exercises.category')}</label>
              <button class="select-btn btn btn--secondary btn--full" data-action="form-pick-category" style="justify-content:space-between;">
                <span>${catLabel}</span>
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            </div>
            <div class="input-group" style="margin-top:var(--space-4);">
              <label class="input-label">${t('exercises.muscle_group')}</label>
              <button class="select-btn btn btn--secondary btn--full" data-action="form-pick-muscle" style="justify-content:space-between;">
                <span>${muscleLabel}</span>
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>`;

      overlay.classList.remove('hidden');
      overlay.onclick = null;

      // Focus sur le champ nom
      const nameInput = document.getElementById('ex-form-name');
      if (nameInput) {
        nameInput.focus();
        nameInput.addEventListener('input', (e) => {
          formName = e.target.value;
          const saveBtn = overlay.querySelector('[data-action="form-save"]');
          if (saveBtn) saveBtn.disabled = !formName.trim();
        });
      }

      overlay.onclick = async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) {
          // Clic sur le fond ferme la modale seulement hors du modal lui-même
          if (e.target === overlay) this._closeModal();
          return;
        }

        switch (btn.dataset.action) {
          case 'form-cancel':
            this._closeModal();
            break;

          case 'form-save':
            if (!formName.trim()) return;
            await this._saveExercise({ name: formName.trim(), category: formCategory, muscleGroup: formMuscle });
            break;

          case 'form-pick-category':
            this._openCategoryPicker(
              formCategory,
              (val) => { formCategory = val; renderForm(); }
            );
            break;

          case 'form-pick-muscle':
            this._openMusclePicker(
              formMuscle,
              (val) => { formMuscle = val; renderForm(); }
            );
            break;
        }
      };
    };

    renderForm();
  }

  // ── Picker catégorie (depuis formulaire) ──────────────────────────────────────

  _openCategoryPicker(currentValue, onSelect) {
    const options = CATEGORIES.map(cat => `
      <div class="picker-option${currentValue === cat.value ? ' picker-option--selected' : ''}"
           data-action="pick-cat"
           data-value="${cat.value}">
        <span class="picker-option__label">${t(cat.key)}</span>
        ${currentValue === cat.value
          ? '<i class="fa-solid fa-check picker-option__check"></i>'
          : ''}
      </div>`).join('');

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal picker-modal">
        <div class="modal__handle"></div>
        <div class="modal__title">${t('exercises.category')}</div>
        <div class="picker-modal__options">
          ${options}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      const opt = e.target.closest('[data-action="pick-cat"]');
      if (opt) {
        onSelect(opt.dataset.value);
        return;
      }
      if (e.target === overlay) onSelect(currentValue); // annuler = garder la valeur
    };
  }

  // ── Picker groupe musculaire (depuis formulaire) ──────────────────────────────

  _openMusclePicker(currentValue, onSelect) {
    const allMuscles = [MUSCLE_NONE, ...MUSCLE_GROUPS];
    const options = allMuscles.map(mg => `
      <div class="picker-option${currentValue === mg.value ? ' picker-option--selected' : ''}"
           data-action="pick-muscle-form"
           data-value="${mg.value}">
        <span class="picker-option__label">${t(mg.key)}</span>
        ${currentValue === mg.value
          ? '<i class="fa-solid fa-check picker-option__check"></i>'
          : ''}
      </div>`).join('');

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal picker-modal">
        <div class="modal__handle"></div>
        <div class="modal__title">${t('exercises.muscle_group')}</div>
        <div class="picker-modal__options">
          ${options}
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = (e) => {
      const opt = e.target.closest('[data-action="pick-muscle-form"]');
      if (opt) {
        onSelect(opt.dataset.value);
        return;
      }
      if (e.target === overlay) onSelect(currentValue);
    };
  }

  // ── Sauvegarde d'un exercice ──────────────────────────────────────────────────

  async _saveExercise({ name, category, muscleGroup }) {
    const newExercise = {
      id:          uid(),
      name:        name,
      category:    category || 'barbell',
      muscleGroup: muscleGroup || '',
      isCustom:    true,
      isArchived:  false,
      usageCount:  0,
      createdAt:   Date.now(),
    };

    try {
      await dbPutExercise(newExercise);
      this._closeModal();
      await this._loadAndRender();

      // Scroller vers l'exercice créé
      requestAnimationFrame(() => {
        const item = this.container.querySelector(`[data-id="${newExercise.id}"]`);
        if (item) {
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
          item.classList.add('exercise-item--highlight');
          setTimeout(() => item.classList.remove('exercise-item--highlight'), 1500);
        }
      });
    } catch (err) {
      console.error('[Exercices] Erreur sauvegarde :', err);
    }
  }

  // ── Archiver / Restaurer ──────────────────────────────────────────────────────

  async _archiveExercise(id, archive) {
    const ex = this._exercises.find(e => e.id === id);
    if (!ex) return;
    await dbPutExercise({ ...ex, isArchived: archive });
    this._closeModal();
    await this._loadAndRender();
  }

  async _deleteExercise(id) {
    const ex = this._exercises.find(e => e.id === id);
    if (!ex || !ex.isCustom) return;
    await dbDelete('exercises', id);
    this._closeModal();
    await this._loadAndRender();
  }

  // ── Long press (archive / restaure) ──────────────────────────────────────────

  _onPointerDown(e) {
    const item = e.target.closest('.exercise-item');
    if (!item) return;

    this._longPressTarget = item;
    this._longPressTimer  = setTimeout(() => {
      this._showItemActions(item.dataset.id);
    }, 500);
  }

  _onPointerUp() {
    clearTimeout(this._longPressTimer);
  }

  _showItemActions(id) {
    const ex = this._exercises.find(e => e.id === id);
    if (!ex) return;

    const isArchived = ex.isArchived === true;
    const isCustom   = ex.isCustom === true;

    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__handle"></div>
        <div class="modal__title">${escapeHtml(ex.name)}</div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          ${isArchived
            ? `<button class="btn btn--full btn--secondary" data-action="restore-exercise" data-id="${id}">
                 <i class="fa-solid fa-box-archive"></i> ${t('action.restore')}
               </button>`
            : `<button class="btn btn--full btn--secondary" data-action="archive-exercise" data-id="${id}">
                 <i class="fa-solid fa-box-archive"></i> ${t('action.archive')}
               </button>`
          }
          ${isCustom
            ? `<button class="btn btn--full btn--danger" data-action="delete-exercise" data-id="${id}" style="margin-top:var(--space-2);">
                 <i class="fa-solid fa-trash"></i> ${t('action.delete')}
               </button>`
            : ''
          }
          <button class="btn btn--full btn--ghost" data-action="close-modal" style="margin-top:var(--space-2);">
            ${t('action.cancel')}
          </button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.onclick = async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) {
        if (e.target === overlay) this._closeModal();
        return;
      }

      switch (btn.dataset.action) {
        case 'archive-exercise':
          await this._archiveExercise(btn.dataset.id, true);
          break;
        case 'restore-exercise':
          await this._archiveExercise(btn.dataset.id, false);
          break;
        case 'delete-exercise':
          await this._deleteExercise(btn.dataset.id);
          break;
        case 'close-modal':
          this._closeModal();
          break;
      }
    };
  }

  // ── Fermeture modale ──────────────────────────────────────────────────────────

  _closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    overlay.onclick   = null;
  }
}

// ── Utilitaire ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
