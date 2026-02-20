/**
 * export.js — Export / Import des données de l'application
 * Gros Monsieur PWA
 *
 * Format d'échange JSON :
 * {
 *   version: 1,
 *   exportedAt: <timestamp ms>,
 *   profile: { ... },
 *   exercises: [ ...exercices personnalisés uniquement... ],
 *   routines: [ ... ],
 *   sessions: [ ... ],
 *   measurements: [ ... ]
 * }
 *
 * Les exercices du seed (isCustom !== true) ne sont jamais exportés
 * ni réimportés : ils se rechargent automatiquement au démarrage.
 */

import {
  dbGetProfile,
  dbGetAllExercises,
  dbGetAllRoutines,
  dbGetAllSessions,
  dbGetAllMeasurements,
  dbSaveProfile,
  dbPutExercise,
  dbPutRoutine,
  dbPutSession,
  dbPutMeasurement,
  dbClearRoutines,
  dbClearSessions,
  dbClearMeasurements,
  dbClearCustomExercises,
} from '../db.js';

/** Version courante du format d'export. Incrémenter si la structure change. */
const EXPORT_VERSION = 1;

/** Champs de premier niveau obligatoires dans un fichier d'import. */
const REQUIRED_FIELDS = ['version', 'exportedAt', 'exercises', 'routines', 'sessions', 'measurements'];

// ── Export ────────────────────────────────────────────────────

/**
 * Exporte toutes les données de l'application en JSON et déclenche
 * le téléchargement du fichier dans le navigateur.
 *
 * Seuls les exercices personnalisés (isCustom: true) sont inclus ;
 * les exercices du seed sont ignorés car ils se rechargent au démarrage.
 *
 * @returns {Promise<void>}
 */
export async function exportData() {
  // 1. Collecte des données depuis IndexedDB
  const [profile, allExercises, routines, sessions, measurements] = await Promise.all([
    dbGetProfile(),
    dbGetAllExercises(),
    dbGetAllRoutines(),
    dbGetAllSessions(),
    dbGetAllMeasurements(),
  ]);

  // 2. Filtrage : on n'exporte que les exercices créés par l'utilisateur
  const customExercises = allExercises.filter((ex) => ex.isCustom === true);

  // 3. Construction de l'objet d'export
  const payload = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    profile: profile ?? null,
    exercises: customExercises,
    routines,
    sessions,
    measurements,
  };

  // 4. Sérialisation JSON
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  // 5. Déclenchement du téléchargement
  const url = URL.createObjectURL(blob);
  const date = new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(payload.exportedAt))
    .replace(/\//g, '-'); // "20-02-2026" → "20-02-2026"

  const a = document.createElement('a');
  a.href = url;
  a.download = `gros-monsieur-${date}.json`;
  document.body.appendChild(a);
  a.click();

  // Nettoyage immédiat (setTimeout 0 pour laisser le temps au téléchargement)
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

// ── Import ────────────────────────────────────────────────────

/**
 * Importe des données depuis un fichier JSON sélectionné par l'utilisateur.
 *
 * Déroulement :
 *  1. Ouvre un <input type="file"> pour laisser l'utilisateur choisir un fichier.
 *  2. Lit et parse le JSON via FileReader.
 *  3. Valide la structure du fichier (version, champs requis).
 *  4. Demande une confirmation avant d'écraser les données existantes.
 *  5. Efface les collections concernées puis réimporte chaque entrée.
 *
 * Note : seuls les exercices dont isCustom === true sont réimportés.
 *
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function importData() {
  // 1. Sélection du fichier via un input temporaire
  const file = await _pickJsonFile();
  if (!file) {
    return { success: false, message: 'Aucun fichier sélectionné.' };
  }

  // 2. Lecture du fichier
  let data;
  try {
    const text = await _readFileAsText(file);
    data = JSON.parse(text);
  } catch {
    return { success: false, message: 'Le fichier est invalide ou corrompu (JSON incorrect).' };
  }

  // 3. Validation de la structure
  const { valid, error } = validateExportData(data);
  if (!valid) {
    return { success: false, message: `Fichier invalide : ${error}` };
  }

  // 4. Confirmation utilisateur
  const dateStr = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(data.exportedAt));

  const confirmed = window.confirm(
    `Importer les données exportées le ${dateStr} ?\n\n` +
    `Cette action remplacera toutes vos données actuelles (routines, séances, mesures, exercices personnalisés).\n\n` +
    `Cette opération est irréversible.`
  );
  if (!confirmed) {
    return { success: false, message: 'Import annulé par l\'utilisateur.' };
  }

  // 5. Import dans IndexedDB
  try {
    // Profil
    if (data.profile) {
      await dbSaveProfile(data.profile);
    }

    // Exercices personnalisés uniquement
    await dbClearCustomExercises();
    const customExercises = (data.exercises ?? []).filter((ex) => ex.isCustom === true);
    for (const ex of customExercises) {
      await dbPutExercise(ex);
    }

    // Routines
    await dbClearRoutines();
    for (const routine of data.routines ?? []) {
      await dbPutRoutine(routine);
    }

    // Sessions
    await dbClearSessions();
    for (const session of data.sessions ?? []) {
      await dbPutSession(session);
    }

    // Mesures
    await dbClearMeasurements();
    for (const measurement of data.measurements ?? []) {
      await dbPutMeasurement(measurement);
    }

    return { success: true, message: 'Données importées avec succès.' };
  } catch (err) {
    console.error('[export.js] Erreur lors de l\'import :', err);
    return { success: false, message: `Erreur lors de l'import : ${err.message}` };
  }
}

// ── Validation ────────────────────────────────────────────────

/**
 * Valide la structure d'un objet d'export.
 *
 * Vérifie :
 *  - que l'objet n'est pas null/undefined
 *  - que tous les champs obligatoires sont présents
 *  - que la version est un entier positif connu
 *  - que les collections sont bien des tableaux
 *
 * @param {any} data
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateExportData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Le fichier ne contient pas un objet JSON valide.' };
  }

  // Champs obligatoires
  for (const field of REQUIRED_FIELDS) {
    if (!(field in data)) {
      return { valid: false, error: `Champ obligatoire manquant : "${field}".` };
    }
  }

  // Version
  if (!Number.isInteger(data.version) || data.version < 1) {
    return { valid: false, error: `Version invalide : "${data.version}".` };
  }
  if (data.version > EXPORT_VERSION) {
    return {
      valid: false,
      error: `Version ${data.version} non supportée (version maximale : ${EXPORT_VERSION}). Mettez l'application à jour.`,
    };
  }

  // exportedAt
  if (typeof data.exportedAt !== 'number' || data.exportedAt <= 0) {
    return { valid: false, error: 'Le champ "exportedAt" doit être un timestamp numérique.' };
  }

  // Collections : doivent être des tableaux
  for (const field of ['exercises', 'routines', 'sessions', 'measurements']) {
    if (!Array.isArray(data[field])) {
      return { valid: false, error: `Le champ "${field}" doit être un tableau.` };
    }
  }

  return { valid: true };
}

// ── Helpers internes ──────────────────────────────────────────

/**
 * Ouvre un sélecteur de fichier et retourne le File sélectionné,
 * ou null si l'utilisateur annule.
 * @returns {Promise<File|null>}
 */
function _pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    // Cas annulation : l'événement "change" ne se déclenche pas.
    // On utilise "cancel" (Chrome 113+) + un focus-fallback pour les autres.
    let resolved = false;

    const done = (file) => {
      if (resolved) return;
      resolved = true;
      document.body.removeChild(input);
      resolve(file ?? null);
    };

    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));

    // Fallback : résolution après que la fenêtre reprend le focus
    // (l'utilisateur a fermé le dialogue sans choisir).
    window.addEventListener(
      'focus',
      () => {
        // Laisse un court délai pour que l'événement "change" passe en premier.
        setTimeout(() => done(null), 300);
      },
      { once: true }
    );

    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Lit un File en tant que texte via FileReader.
 * @param {File} file
 * @returns {Promise<string>}
 */
function _readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.readAsText(file, 'UTF-8');
  });
}
