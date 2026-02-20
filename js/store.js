/**
 * store.js — État global réactif (observer pattern) pour Gros Monsieur
 *
 * Minimaliste, vanilla JS, aucune dépendance.
 *
 * Usage :
 *   import { state, setState, getState, subscribe, unsubscribe } from './store.js';
 *
 *   // Lire
 *   const profile = getState('profile');
 *
 *   // Écrire et notifier les abonnés
 *   setState('profile', { name: 'John' });
 *
 *   // S'abonner aux changements d'une clé
 *   function onProfileChange(newValue, oldValue) { ... }
 *   subscribe('profile', onProfileChange);
 *
 *   // Se désabonner
 *   unsubscribe('profile', onProfileChange);
 */

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------

/**
 * Objet d'état mutable partagé dans toute l'application.
 * La référence est stable : les modules qui l'importent gardent un accès live.
 *
 * @type {{
 *   profile:       object|null,  // Profil utilisateur
 *   activeSession: object|null,  // Session d'entraînement en cours
 *   sessionTimer:  number|null,  // Référence setInterval du chronomètre de session
 * }}
 */
export const state = {
  profile:       null,
  activeSession: null,
  sessionTimer:  null,
};

// ---------------------------------------------------------------------------
// Registre des abonnés
// ---------------------------------------------------------------------------

/**
 * Map<key, Set<Function>> — liste des callbacks par clé d'état.
 * Utilisée en interne uniquement.
 *
 * @type {Map<string, Set<Function>>}
 */
const _listeners = new Map();

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * S'abonne aux changements d'une clé de l'état.
 * Le callback reçoit (newValue, oldValue) à chaque appel de setState.
 *
 * @param {string}   key - Clé de `state` à observer (ex. 'profile')
 * @param {Function} fn  - Fonction appelée lors d'un changement : fn(newValue, oldValue)
 */
export function subscribe(key, fn) {
  if (typeof fn !== 'function') {
    throw new TypeError(`[store] subscribe : le callback doit être une fonction (reçu : ${typeof fn})`);
  }

  if (!_listeners.has(key)) {
    _listeners.set(key, new Set());
  }

  _listeners.get(key).add(fn);
}

/**
 * Se désabonne d'une clé de l'état.
 * Sans effet si la fonction n'était pas abonnée.
 *
 * @param {string}   key - Clé de `state`
 * @param {Function} fn  - Fonction à retirer
 */
export function unsubscribe(key, fn) {
  const fns = _listeners.get(key);
  if (fns) {
    fns.delete(fn);
    // Nettoie l'entrée Map si plus aucun abonné
    if (fns.size === 0) {
      _listeners.delete(key);
    }
  }
}

/**
 * Met à jour une clé de l'état et notifie tous les abonnés de cette clé.
 * La notification est synchrone.
 *
 * @param {string} key   - Clé de `state` à modifier
 * @param {*}      value - Nouvelle valeur
 */
export function setState(key, value) {
  if (!(key in state)) {
    console.warn(`[store] setState : clé inconnue "${key}". L'état ne sera pas étendu dynamiquement.`);
    return;
  }

  const oldValue = state[key];

  // Pas de notification si la valeur est identique (référence ou primitive)
  if (oldValue === value) return;

  state[key] = value;

  // Notification des abonnés
  const fns = _listeners.get(key);
  if (fns && fns.size > 0) {
    for (const fn of fns) {
      try {
        fn(value, oldValue);
      } catch (err) {
        console.error(`[store] Erreur dans un abonné de "${key}" :`, err);
      }
    }
  }
}

/**
 * Lit la valeur courante d'une clé de l'état.
 *
 * @param {string} key - Clé de `state`
 * @returns {*}        - Valeur courante de state[key]
 */
export function getState(key) {
  return state[key];
}
