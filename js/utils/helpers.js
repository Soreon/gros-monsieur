/**
 * helpers.js — Fonctions utilitaires pures
 * Gros Monsieur PWA
 *
 * Aucune dépendance externe. Toutes les fonctions sont exportées nommément.
 */

// ── Identifiants ─────────────────────────────────────────────

/**
 * Génère un UUID v4.
 * Utilise crypto.randomUUID() si disponible (navigateurs modernes),
 * sinon fallback manuel basé sur crypto.getRandomValues().
 * @returns {string}
 */
export function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback : construction manuelle d'un UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0x0f) | (c === 'y' ? 0x80 : 0);
    return (c === 'x' ? (crypto.getRandomValues(new Uint8Array(1))[0] & 0x0f) : r)
      .toString(16);
  });
}

// ── Formatage durée ──────────────────────────────────────────

/**
 * Formate une durée en secondes.
 * @param {number} seconds
 * @param {boolean} showSeconds - Affiche les secondes si true (défaut false)
 * @returns {string} ex: "1h 23m", "45m", "1h 23m 45s"
 */
export function formatDuration(seconds, showSeconds = false) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (showSeconds && s > 0) parts.push(`${s}s`);
  if (parts.length === 0) {
    // Durée nulle : affiche "0m" ou "0s" selon le mode
    return showSeconds ? '0s' : '0m';
  }
  return parts.join(' ');
}

// ── Formatage dates ──────────────────────────────────────────

/**
 * Formate un timestamp en date longue localisée.
 * @param {number} timestamp - Millisecondes epoch
 * @param {Intl.DateTimeFormatOptions} options - Options Intl (optionnel)
 * @returns {string} ex: "mardi 17 février 2026"
 */
export function formatDate(timestamp, options = {}) {
  const defaults = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('fr-FR', { ...defaults, ...options }).format(
    new Date(timestamp)
  );
}

/**
 * Formate un timestamp en date courte.
 * @param {number} timestamp
 * @returns {string} ex: "17/02/2026"
 */
export function formatDateShort(timestamp) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/**
 * Formate un timestamp en heure HH:MM.
 * @param {number} timestamp
 * @returns {string} ex: "12:08"
 */
export function formatTime(timestamp) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

/**
 * Retourne le label Mois + Année d'un timestamp (première lettre majuscule).
 * @param {number} timestamp
 * @returns {string} ex: "Février 2026"
 */
export function formatMonthYear(timestamp) {
  const raw = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(timestamp));
  // Capitalise la première lettre (Intl renvoie parfois en minuscule selon l'env.)
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ── Regroupement ─────────────────────────────────────────────

/**
 * Regroupe un tableau d'objets selon une fonction de clé.
 * @template T
 * @param {T[]} array
 * @param {(item: T) => string} keyFn
 * @returns {Map<string, T[]>}
 *
 * @example
 * groupBy(sessions, s => formatMonthYear(s.startTime))
 * // → Map { 'Février 2026' => [...], 'Janvier 2026' => [...] }
 */
export function groupBy(array, keyFn) {
  const map = new Map();
  for (const item of array) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// ── Fitness / sport ──────────────────────────────────────────

/**
 * Calcule le 1RM estimé (formule Epley).
 * 1RM = weight × (1 + reps / 30)
 *
 * - Si reps <= 1 : retourne weight directement (1 rep = le poids lui-même).
 * - Si weight ou reps invalides : retourne 0.
 *
 * @param {number} weight - Poids soulevé (kg)
 * @param {number} reps   - Nombre de répétitions
 * @returns {number} 1RM arrondi à 0.5 kg près
 */
export function estimate1RM(weight, reps) {
  if (!weight || weight <= 0 || !reps || reps <= 0) return 0;
  if (reps === 1) return weight;
  const raw = weight * (1 + reps / 30);
  // Arrondi au 0.5 le plus proche
  return Math.round(raw * 2) / 2;
}

/**
 * Formate un poids en kilogrammes.
 * Utilise la virgule décimale française.
 * @param {number} kg
 * @returns {string} ex: "100 kg", "22,5 kg"
 */
export function formatWeight(kg) {
  const formatted = Number(kg).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} kg`;
}

/**
 * Formate un nombre de répétitions.
 * @param {number} reps
 * @returns {string} ex: "× 10"
 */
export function formatReps(reps) {
  return `\u00D7\u00A0${reps}`;
}

// ── Semaines ─────────────────────────────────────────────────

/**
 * Retourne le début de semaine (lundi à 00:00:00.000) d'un timestamp.
 * @param {number} timestamp
 * @returns {number} Timestamp du lundi de la semaine (ms)
 */
export function startOfWeek(timestamp) {
  const d = new Date(timestamp);
  // getDay() : 0 = dimanche, 1 = lundi, …, 6 = samedi
  const day = d.getDay();
  // Décalage pour ramener au lundi (iso week : lundi = 1er jour)
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Retourne un tableau des débuts de semaine des 8 dernières semaines,
 * de la plus ancienne à la plus récente.
 * @returns {number[]} 8 timestamps (lundi 00:00:00)
 */
export function getLast8Weeks() {
  const now = Date.now();
  const currentWeekStart = startOfWeek(now);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    weeks.push(currentWeekStart - i * 7 * 24 * 60 * 60 * 1000);
  }
  return weeks;
}

// ── Comparaison de dates ─────────────────────────────────────

/**
 * Retourne true si deux timestamps correspondent au même jour calendaire.
 * @param {number} ts1
 * @param {number} ts2
 * @returns {boolean}
 */
export function isSameDay(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// ── Chaînes de caractères ────────────────────────────────────

/**
 * Tronque un texte à n caractères en ajoutant "…" si nécessaire.
 * @param {string} str
 * @param {number} n - Longueur maximale (incluant le "…")
 * @returns {string}
 */
export function truncate(str, n) {
  if (typeof str !== 'string') return '';
  if (str.length <= n) return str;
  return str.slice(0, n - 1) + '\u2026';
}

/**
 * Capitalise la première lettre d'une chaîne.
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
  if (typeof str !== 'string' || str.length === 0) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Performance ───────────────────────────────────────────────

/**
 * Retarde l'exécution de fn de wait millisecondes.
 * Chaque nouvel appel réinitialise le délai.
 * @param {Function} fn
 * @param {number} wait - Délai en millisecondes
 * @returns {Function} Fonction debounced
 */
export function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}
