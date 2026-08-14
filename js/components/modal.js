// =============================================================================
// js/components/modal.js — Composant modale unifié (#modal-overlay)
// =============================================================================
//
// UN SEUL point d'entrée pour toutes les modales de l'app (pickers, action
// sheets, formulaires, confirmations). Remplace les manipulations directes
// de #modal-overlay autrefois dupliquées dans chaque page.
//
// Usage :
//   const { el, close } = openModal(html, {
//     dismissible: true,      // clic sur le backdrop → fermeture (défaut)
//     onBackdrop:  () => {},  // clic backdrop personnalisé (prime sur dismissible)
//     onClick:     (e) => {}, // délégation des clics DANS la modale
//     onInput:     (e) => {}, // délégation des inputs DANS la modale
//     onClose:     () => {},  // appelé UNE SEULE fois à la fermeture réelle
//   });
//
// Sémantique :
// - openModal alors qu'une modale est déjà ouverte = REMPLACEMENT à chaud
//   (flux multi-étapes : picker → formulaire, re-render d'une même modale).
//   L'overlay reste visible (pas de re-déclenchement de l'animation du fond)
//   et le onClose de la modale remplacée n'est PAS déclenché — c'est le
//   comportement historique des pages.
// - closeModal() ferme la modale courante : ajoute .hidden, vide innerHTML,
//   nettoie onclick/oninput, retire le listener Escape, puis appelle onClose.
// - Escape ferme TOUJOURS la modale courante (fermeture « dure »), même si
//   dismissible: false — aligné sur le comportement historique (entrainement).
// - `el` est l'élément #modal-overlay : utile pour interroger/mettre à jour
//   le CONTENU injecté (el.querySelector(...)). Les pages ne doivent jamais
//   toucher à la mécanique de l'overlay elle-même (classes, onclick, …).

let _active = null; // état de la modale ouverte : { dismissible, onClose, … }

function _getOverlay() {
  return document.getElementById('modal-overlay');
}

/**
 * Ouvre (ou remplace) la modale dans #modal-overlay.
 * @param {string} html - Contenu injecté dans l'overlay (ex. `<div class="modal">…</div>`)
 * @param {object} [opts]
 * @param {boolean}  [opts.dismissible=true] - Clic sur le backdrop → fermeture
 * @param {Function} [opts.onBackdrop] - Action personnalisée au clic backdrop
 *   (prioritaire sur dismissible ; la modale n'est pas fermée automatiquement)
 * @param {Function} [opts.onClick] - Délégation des clics non-backdrop
 * @param {Function} [opts.onInput] - Délégation des événements input
 * @param {Function} [opts.onClose] - Callback appelé une seule fois à la fermeture
 * @returns {{ el: HTMLElement|null, close: Function }}
 */
export function openModal(html, opts = {}) {
  const overlay = _getOverlay();
  if (!overlay) return { el: null, close: closeModal };

  // Remplacement à chaud : ne déclenche PAS le onClose de la modale précédente,
  // mais retire son listener Escape pour ne pas les empiler.
  if (_active) {
    document.removeEventListener('keydown', _active.escHandler);
    _active = null;
  }

  const state = {
    dismissible: opts.dismissible !== false,
    onBackdrop:  typeof opts.onBackdrop === 'function' ? opts.onBackdrop : null,
    onClick:     typeof opts.onClick    === 'function' ? opts.onClick    : null,
    onInput:     typeof opts.onInput    === 'function' ? opts.onInput    : null,
    onClose:     typeof opts.onClose    === 'function' ? opts.onClose    : null,
    escHandler:  null,
    closed:      false,
  };

  overlay.innerHTML = html;
  overlay.classList.remove('hidden');

  // onclick/oninput assignés (pas addEventListener) : chaque ouverture
  // remplace les handlers précédents — aucun empilement possible.
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      if (state.onBackdrop) state.onBackdrop();
      else if (state.dismissible) closeModal();
      return;
    }
    if (state.onClick) state.onClick(e);
  };

  overlay.oninput = state.onInput ? (e) => state.onInput(e) : null;

  state.escHandler = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', state.escHandler);

  _active = state;
  return { el: overlay, close: closeModal };
}

/**
 * Ferme la modale courante. Sans effet visible si aucune n'est ouverte
 * (l'overlay est tout de même remis à l'état caché, par sécurité).
 */
export function closeModal() {
  const state = _active;
  _active = null;
  if (state) document.removeEventListener('keydown', state.escHandler);

  const overlay = _getOverlay();
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    overlay.onclick = null;
    overlay.oninput = null;
  }

  if (state && !state.closed && state.onClose) {
    state.closed = true;
    state.onClose();
  }
}

/** @returns {boolean} true si une modale ouverte via openModal est affichée */
export function isModalOpen() {
  return _active !== null;
}
