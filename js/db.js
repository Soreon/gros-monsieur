/**
 * db.js — Wrapper IndexedDB pour Gros Monsieur
 *
 * API Promise-based, connexion singleton, rouverte automatiquement si fermée.
 *
 * Object stores :
 *   - exercises    (keyPath: id)
 *   - routines     (keyPath: id)
 *   - sessions     (keyPath: id)
 *   - measurements (keyPath: id)
 *   - profile      (keyPath: id, singleton id='singleton')
 */

const DB_NAME    = 'gros-monsieur-db';
const DB_VERSION = 1;

/** Référence singleton vers la connexion IDBDatabase ouverte. */
let _db = null;

// ---------------------------------------------------------------------------
// Ouverture / initialisation
// ---------------------------------------------------------------------------

/**
 * Ouvre (ou retourne) la connexion IndexedDB.
 * Crée les object stores et les index lors de la première ouverture (ou upgrade).
 *
 * @returns {Promise<IDBDatabase>}
 */
export async function openDB() {
  // Retourner la connexion existante si elle est encore ouverte
  if (_db) return _db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // -----------------------------------------------------------------------
    // Création / migration du schéma
    // -----------------------------------------------------------------------
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // --- exercises --------------------------------------------------------
      if (!db.objectStoreNames.contains('exercises')) {
        const exercises = db.createObjectStore('exercises', { keyPath: 'id' });
        exercises.createIndex('name',        'name',        { unique: true });
        exercises.createIndex('muscleGroup', 'muscleGroup', { unique: false });
        exercises.createIndex('isArchived',  'isArchived',  { unique: false });
        exercises.createIndex('category',    'category',    { unique: false });
      }

      // --- routines ---------------------------------------------------------
      if (!db.objectStoreNames.contains('routines')) {
        const routines = db.createObjectStore('routines', { keyPath: 'id' });
        routines.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }

      // --- sessions ---------------------------------------------------------
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('startTime', 'startTime', { unique: false });
        sessions.createIndex('routineId', 'routineId', { unique: false });
      }

      // --- measurements -----------------------------------------------------
      if (!db.objectStoreNames.contains('measurements')) {
        const measurements = db.createObjectStore('measurements', { keyPath: 'id' });
        measurements.createIndex('type',        'type',             { unique: false });
        measurements.createIndex('date',        'date',             { unique: false });
        measurements.createIndex('[type, date]', ['type', 'date'],  { unique: false });
      }

      // --- profile (singleton, id = 'singleton') ----------------------------
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
        // Pas d'index — accès direct par id
      }
    };

    // -----------------------------------------------------------------------
    // Connexion réussie
    // -----------------------------------------------------------------------
    request.onsuccess = (event) => {
      _db = event.target.result;

      // Si la connexion est fermée de l'extérieur (ex. versionchange), on réinitialise
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };

      resolve(_db);
    };

    request.onerror = (event) => {
      reject(new Error(`[db] Échec d'ouverture : ${event.target.error}`));
    };

    request.onblocked = () => {
      console.warn('[db] Ouverture bloquée — une autre connexion est ouverte.');
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/**
 * Retourne un object store dans une transaction.
 *
 * @param {string} storeName   - Nom du store
 * @param {'readonly'|'readwrite'} mode
 * @returns {Promise<IDBObjectStore>}
 */
async function _getStore(storeName, mode = 'readonly') {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

/**
 * Encapsule une requête IDB dans une Promise.
 *
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function _wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Récupère un enregistrement par son id.
 *
 * @param {string} store - Nom du store
 * @param {*}      id    - Clé primaire
 * @returns {Promise<any|undefined>}
 */
export async function dbGet(store, id) {
  const s = await _getStore(store, 'readonly');
  return _wrapRequest(s.get(id));
}

/**
 * Insère ou met à jour un enregistrement (upsert).
 *
 * @param {string} store - Nom du store
 * @param {object} obj   - Objet à persister (doit contenir la keyPath)
 * @returns {Promise<*>} - La clé de l'enregistrement écrit
 */
export async function dbPut(store, obj) {
  const s = await _getStore(store, 'readwrite');
  return _wrapRequest(s.put(obj));
}

/**
 * Supprime un enregistrement par son id.
 *
 * @param {string} store - Nom du store
 * @param {*}      id    - Clé primaire
 * @returns {Promise<void>}
 */
export async function dbDelete(store, id) {
  const s = await _getStore(store, 'readwrite');
  return _wrapRequest(s.delete(id));
}

/**
 * Retourne tous les enregistrements du store.
 *
 * @param {string} store - Nom du store
 * @returns {Promise<any[]>}
 */
export async function dbGetAll(store) {
  const s = await _getStore(store, 'readonly');
  return _wrapRequest(s.getAll());
}

/**
 * Retourne tous les enregistrements dont l'index correspond à la valeur donnée.
 *
 * @param {string} store     - Nom du store
 * @param {string} indexName - Nom de l'index
 * @param {*}      value     - Valeur recherchée
 * @returns {Promise<any[]>}
 */
export async function dbGetByIndex(store, indexName, value) {
  const s     = await _getStore(store, 'readonly');
  const index = s.index(indexName);
  return _wrapRequest(index.getAll(value));
}

/**
 * Retourne tous les enregistrements dont la valeur d'index est comprise
 * dans l'intervalle [lower, upper] (bornes incluses).
 *
 * @param {string} store     - Nom du store
 * @param {string} indexName - Nom de l'index
 * @param {*}      lower     - Borne inférieure (inclusive)
 * @param {*}      upper     - Borne supérieure (inclusive)
 * @returns {Promise<any[]>}
 */
export async function dbGetAllByRange(store, indexName, lower, upper) {
  const s     = await _getStore(store, 'readonly');
  const index = s.index(indexName);
  const range = IDBKeyRange.bound(lower, upper);
  return _wrapRequest(index.getAll(range));
}

/**
 * Vide entièrement un store (supprime tous les enregistrements).
 *
 * @param {string} store - Nom du store
 * @returns {Promise<void>}
 */
export async function dbClear(store) {
  const s = await _getStore(store, 'readwrite');
  return _wrapRequest(s.clear());
}

/**
 * Retourne le nombre d'enregistrements dans un store.
 *
 * @param {string} store - Nom du store
 * @returns {Promise<number>}
 */
export async function dbCount(store) {
  const s = await _getStore(store, 'readonly');
  return _wrapRequest(s.count());
}

// ---------------------------------------------------------------------------
// Fonctions de commodité par store (utilisées par les pages et export.js)
// ---------------------------------------------------------------------------

// ── Profile ──────────────────────────────────────────────────────────────────

/** Retourne le profil utilisateur (singleton). */
export async function dbGetProfile() {
  return dbGet('profile', 'singleton');
}

/** Sauvegarde le profil utilisateur (force id='singleton'). */
export async function dbSaveProfile(profile) {
  return dbPut('profile', { ...profile, id: 'singleton' });
}

// ── Exercises ────────────────────────────────────────────────────────────────

/** Retourne tous les exercices (seed + personnalisés). */
export async function dbGetAllExercises() {
  return dbGetAll('exercises');
}

/** Insère ou met à jour un exercice. */
export async function dbPutExercise(exercise) {
  return dbPut('exercises', exercise);
}

/** Supprime uniquement les exercices personnalisés (isCustom: true). */
export async function dbClearCustomExercises() {
  const all = await dbGetAll('exercises');
  const custom = all.filter(ex => ex.isCustom === true);
  await Promise.all(custom.map(ex => dbDelete('exercises', ex.id)));
}

// ── Routines ─────────────────────────────────────────────────────────────────

/** Retourne toutes les routines. */
export async function dbGetAllRoutines() {
  return dbGetAll('routines');
}

/** Insère ou met à jour une routine. */
export async function dbPutRoutine(routine) {
  return dbPut('routines', routine);
}

/** Supprime toutes les routines. */
export async function dbClearRoutines() {
  return dbClear('routines');
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** Retourne toutes les sessions d'entraînement. */
export async function dbGetAllSessions() {
  return dbGetAll('sessions');
}

/** Insère ou met à jour une session. */
export async function dbPutSession(session) {
  return dbPut('sessions', session);
}

/** Supprime toutes les sessions. */
export async function dbClearSessions() {
  return dbClear('sessions');
}

// ── Measurements ─────────────────────────────────────────────────────────────

/** Retourne toutes les mesures. */
export async function dbGetAllMeasurements() {
  return dbGetAll('measurements');
}

/** Insère ou met à jour une mesure. */
export async function dbPutMeasurement(measurement) {
  return dbPut('measurements', measurement);
}

/** Supprime toutes les mesures. */
export async function dbClearMeasurements() {
  return dbClear('measurements');
}

// ---------------------------------------------------------------------------
// Initialisation au premier lancement
// ---------------------------------------------------------------------------

/**
 * Initialise la base de données :
 *  - Insère les exercices du seed si le store est vide (premier lancement).
 *  - Crée le profil par défaut s'il n'existe pas.
 *
 * Doit être appelé une seule fois au démarrage de l'app.
 */
export async function initDB() {
  await openDB();

  // Seed des exercices
  const count = await dbCount('exercises');
  if (count === 0) {
    const { EXERCISES_SEED } = await import('./data/exercises-seed.js');
    for (const exercise of EXERCISES_SEED) {
      await dbPut('exercises', exercise);
    }
    console.log(`[db] ${EXERCISES_SEED.length} exercices chargés depuis le seed.`);
  }

  // Profil par défaut
  const profile = await dbGet('profile', 'singleton');
  if (!profile) {
    await dbPut('profile', {
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
        restTimer: {
          simpleTimers: false,
          defaultSeconds: 90,
        },
      },
      dashboardWidgets: [
        { id: 'weekly_workouts', config: {} },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log('[db] Profil par défaut créé.');
  }
}
