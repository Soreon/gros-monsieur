/**
 * strong-import.js — Import de séances depuis un export CSV de l'app Strong
 * Gros Monsieur PWA
 *
 * Format d'entrée : CSV exporté par Strong (séparateur ';', champs entre
 * guillemets doubles, retours à la ligne possibles à l'intérieur des champs).
 * En-tête attendu :
 *   Workout #;Date;Workout Name;Duration (sec);Exercise Name;Set Order;
 *   Weight (kg);Reps;RPE;Distance (meters);Seconds;Notes;Workout Notes
 *
 * Flux : pickCsvFile() → parseStrongCsv() → suggestMatches() → runImport().
 * Les sessions produites suivent EXACTEMENT le schéma de _finishSession()
 * (js/pages/session.js) pour s'afficher parfaitement dans l'historique.
 */

import { t } from '../i18n.js';
import { uid, estimate1RM, normalize } from './helpers.js';
import { dbTransaction } from '../db.js';

/** En-tête exact d'un export CSV Strong (13 colonnes, séparateur ';'). */
const STRONG_HEADER = [
  'Workout #', 'Date', 'Workout Name', 'Duration (sec)', 'Exercise Name',
  'Set Order', 'Weight (kg)', 'Reps', 'RPE', 'Distance (meters)',
  'Seconds', 'Notes', 'Workout Notes',
];

/** Index des colonnes (voir STRONG_HEADER). */
const COL = {
  workout: 0, date: 1, name: 2, duration: 3, exercise: 4,
  order: 5, weight: 6, reps: 7, rpe: 8, distance: 9,
  seconds: 10, notes: 11, workoutNotes: 12,
};

/**
 * Table de traduction des suffixes de matériel Strong → seed, construite
 * d'après les suffixes réellement utilisés par exercises-seed.js :
 *   (Barbell) / (Machine)  → identiques dans le seed (aucune traduction)
 *   (Dumbbell)             → (Haltère) ou (Haltères)
 *   (Cable)                → (Machine)  (Cable Fly/Row/Curl (Machine) du seed)
 *   (Bodyweight)           → (Poids corporel)
 * Les motifs et variantes sont exprimés en forme normalisée (normalize()).
 */
const STRONG_SUFFIX_VARIANTS = [
  [/\(dumbbell\)/,   ['(haltere)', '(halteres)']],
  [/\(cable\)/,      ['(machine)']],
  [/\(bodyweight\)/, ['(poids corporel)']],
];

// ── Sélection + lecture du fichier ────────────────────────────

/**
 * Répare un texte UTF-8 doublement encodé (mojibake « Ã© », « Ã¨ », « Ã® »…).
 * Détection : « Ã » suivi d'un caractère U+0080–U+00BF. Réparation :
 * ré-encodage latin1 → UTF-8. La version réparée n'est conservée que si
 * elle contient strictement moins de « Ã » que l'originale.
 * @param {string} text
 * @returns {string} Texte réparé, ou l'original si la réparation n'apporte rien
 */
export function repairMojibake(text) {
  if (!/\u00C3[\u0080-\u00BF]/.test(text)) return text;

  let repaired;
  try {
    repaired = new TextDecoder('utf-8').decode(
      Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)
    );
  } catch {
    return text;
  }

  const countA = (s) => (s.match(/Ã/g) || []).length;
  return countA(repaired) < countA(text) ? repaired : text;
}

/**
 * Ouvre un sélecteur de fichier CSV, lit le fichier choisi en ArrayBuffer,
 * le décode en UTF-8 et répare un éventuel double encodage (mojibake).
 *
 * Même pattern robuste que le sélecteur d'export.js : résolution unique,
 * événement "cancel" (Chrome 113+) + fallback focus avec re-vérification
 * de input.files (l'événement "change" peut être différé sur iOS).
 *
 * @returns {Promise<string|null>} Contenu texte du CSV, ou null si annulé
 */
export function pickCsvFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';

    let resolved = false;

    const done = (file) => {
      if (resolved) return;
      resolved = true;
      document.body.removeChild(input);

      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = new TextDecoder('utf-8').decode(e.target.result);
          resolve(repairMojibake(text));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
      reader.readAsArrayBuffer(file);
    };

    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));

    // Fallback : résolution après que la fenêtre reprend le focus
    // (l'utilisateur a fermé le dialogue sans choisir).
    window.addEventListener(
      'focus',
      () => {
        // Délai généreux pour laisser l'événement "change" passer en premier.
        setTimeout(() => {
          done(input.files?.[0] ?? null);
        }, 1000);
      },
      { once: true }
    );

    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  });
}

// ── Parsing CSV ───────────────────────────────────────────────

/**
 * Découpe un texte CSV (séparateur ';') en lignes de champs.
 * Petit automate : gère les champs entre guillemets, les guillemets
 * échappés ("") et les retours à la ligne à l'intérieur des champs.
 * Les lignes entièrement vides sont ignorées.
 * @param {string} text
 * @returns {string[][]}
 */
function _parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow   = () => { pushField(); rows.push(row); row = []; };

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // "" échappé
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"')  { inQuotes = true; i++; continue; }
    if (c === ';')  { pushField(); i++; continue; }
    if (c === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }

    field += c; i++;
  }

  // Dernière ligne sans retour final
  if (field !== '' || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * Parse un timestamp local depuis "YYYY-MM-DD HH:MM:SS" (heure locale).
 * @param {string} str
 * @returns {number} Timestamp ms, ou 0 si non parsable
 */
function _parseLocalDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  }
  const ts = new Date(str.replace(' ', 'T')).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Parse le contenu d'un export CSV Strong.
 *
 * @param {string} text - Contenu du fichier (déjà décodé/réparé)
 * @returns {{
 *   workouts: {
 *     name: string,
 *     startTime: number,
 *     durationSec: number,
 *     exercises: { name: string, note: string, sets: object[] }[],
 *   }[],
 *   exerciseNames: { name: string, workoutCount: number }[],
 * }}
 * - workouts : groupés par « Workout # », ordre des lignes préservé. Les blocs
 *   d'un même exercice (même nom réapparaissant plus loin dans la séance)
 *   sont fusionnés à la suite dans le même exercice.
 * - exerciseNames : noms distincts (trimés) dans l'ordre de première
 *   apparition, avec le nombre de séances où chacun apparaît.
 * @throws {Error} Si l'en-tête ne correspond pas à un export Strong
 */
export function parseStrongCsv(text) {
  const rows = _parseCsvRows(String(text ?? '').replace(/^\uFEFF/, ''));

  const header = rows.length > 0 ? rows[0].map((h) => h.trim()) : [];
  const headerOk =
    header.length === STRONG_HEADER.length &&
    STRONG_HEADER.every((h, i) => header[i] === h);
  if (!headerOk) {
    throw new Error(t('strong.invalid'));
  }

  const workoutsByKey = new Map(); // Workout # → workout (+ index _byName)
  const namesOrder    = [];        // noms distincts, ordre de première apparition
  const nameWorkouts  = new Map(); // nom → Set(Workout #)

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < STRONG_HEADER.length) continue; // ligne incomplète : ignorée

    const key = row[COL.workout].trim();
    if (!key) continue;

    let workout = workoutsByKey.get(key);
    if (!workout) {
      workout = {
        name:        row[COL.name].trim(),
        startTime:   _parseLocalDate(row[COL.date].trim()),
        durationSec: parseInt(row[COL.duration], 10) || 0,
        exercises:   [],
        _byName:     new Map(), // fusion des blocs d'un même exercice
      };
      workoutsByKey.set(key, workout);
    }

    const exName = row[COL.exercise].trim();
    if (!exName) continue;

    let exercise = workout._byName.get(exName);
    if (!exercise) {
      exercise = { name: exName, note: '', sets: [] };
      workout._byName.set(exName, exercise);
      workout.exercises.push(exercise);
    }

    if (!nameWorkouts.has(exName)) {
      nameWorkouts.set(exName, new Set());
      namesOrder.push(exName);
    }
    nameWorkouts.get(exName).add(key);

    const order   = row[COL.order].trim();
    const seconds = Math.round(parseFloat(row[COL.seconds]) || 0);

    // Minuteur de repos → set 'timer' inséré à sa place (ignoré si vide/0)
    if (order === 'Rest Timer') {
      if (seconds > 0) {
        exercise.sets.push({
          type: 'timer', duration: seconds,
          completed: true, weight: 0, reps: 0, isPR: false,
        });
      }
      continue;
    }

    // Note d'exercice → concaténée à la note (' — ' si plusieurs)
    if (order === 'Note') {
      const note = row[COL.notes].trim();
      if (note) {
        exercise.note = exercise.note ? `${exercise.note} — ${note}` : note;
      }
      continue;
    }

    // Série : numérique = normale, D = dégressive, F = échec, W = échauffement
    let type = null;
    if (/^\d+$/.test(order))   type = 'normal';
    else if (order === 'D')    type = 'drop';
    else if (order === 'F')    type = 'failure';
    else if (order === 'W')    type = 'warmup';
    if (!type) continue; // valeur inconnue : ignorée (défensif)

    const set = {
      type,
      weight:    parseFloat(row[COL.weight]) || 0,
      reps:      parseInt(row[COL.reps], 10) || 0,
      completed: true,
      isPR:      false,
    };
    // Exercice à durée (type Plank) : Seconds sans reps → duration
    if (seconds > 0 && set.reps <= 0) set.duration = seconds;

    exercise.sets.push(set);
  }

  const workouts = [...workoutsByKey.values()];
  for (const w of workouts) delete w._byName;

  const exerciseNames = namesOrder.map((name) => ({
    name,
    workoutCount: nameWorkouts.get(name).size,
  }));

  return { workouts, exerciseNames };
}

// ── Suggestion de correspondances ─────────────────────────────

/**
 * Suggère, pour chaque nom d'exercice importé, l'exercice existant
 * correspondant :
 *  1. égalité exacte (après trim) ;
 *  2. égalité en forme normalisée (minuscules, sans accents) ;
 *  3. égalité après traduction des suffixes de matériel Strong → seed
 *     (voir STRONG_SUFFIX_VARIANTS).
 *
 * @param {({name: string}|string)[]} exerciseNames - Noms importés
 * @param {object[]} existingExercises - Exercices existants (seed + persos)
 * @returns {Map<string, string|null>} nom importé → id existant suggéré ou null
 */
export function suggestMatches(exerciseNames, existingExercises) {
  const byExact = new Map();
  const byNorm  = new Map();
  for (const ex of existingExercises) {
    if (!ex || typeof ex.name !== 'string') continue;
    const nameTrim = ex.name.trim();
    if (!byExact.has(nameTrim)) byExact.set(nameTrim, ex.id);
    const norm = normalize(nameTrim);
    if (!byNorm.has(norm)) byNorm.set(norm, ex.id);
  }

  const result = new Map();
  for (const entry of exerciseNames) {
    const name = String(typeof entry === 'string' ? entry : entry.name).trim();

    // 1. Exact
    let id = byExact.get(name) ?? null;

    // 2. Normalisé
    if (!id) id = byNorm.get(normalize(name)) ?? null;

    // 3. Traduction des suffixes Strong → seed (en forme normalisée)
    if (!id) {
      const norm = normalize(name);
      outer:
      for (const [pattern, variants] of STRONG_SUFFIX_VARIANTS) {
        if (!pattern.test(norm)) continue;
        for (const variant of variants) {
          const candidate = byNorm.get(norm.replace(pattern, variant));
          if (candidate) { id = candidate; break outer; }
        }
      }
    }

    result.set(name, id);
  }
  return result;
}

// ── Import ────────────────────────────────────────────────────

/**
 * Importe les workouts parsés dans IndexedDB.
 *
 * - `mapping` : nom importé → id d'exercice existant, ou 'create' pour créer
 *   un exercice personnalisé (défauts du formulaire de création :
 *   category 'barbell', muscleGroup ''). Si un exercice existant porte déjà
 *   ce nom (index unique `name`), il est réutilisé au lieu d'être créé.
 * - Déduplication : un workout est ignoré si une session existante — ou déjà
 *   importée dans ce lot — a exactement le même startTime (ms).
 * - PRs chronologiques : sessions existantes + importées fusionnées et triées
 *   par startTime ; un max courant d'e1RM par exercice est maintenu et seuls
 *   les sets IMPORTÉS qui le battent sont marqués isPR (les sessions
 *   existantes ne sont jamais modifiées). Sets 'timer' et weight/reps ≤ 0
 *   sont ignorés du calcul.
 * - usageCount : +1 par séance importée où l'exercice a au moins un set
 *   non-timer (les exercices existants modifiés sont ré-écrits).
 * - Écriture : UNE SEULE transaction ['exercises','sessions'] — atomique,
 *   toute erreur = rien d'écrit.
 *
 * @param {object} params
 * @param {object[]} params.workouts - Workouts issus de parseStrongCsv
 * @param {Map<string, string>} params.mapping - nom importé → exerciseId | 'create'
 * @param {object[]} params.existingSessions - Sessions déjà en base
 * @param {object[]} params.existingExercises - Exercices déjà en base
 * @returns {Promise<{imported: number, skipped: number, createdExercises: number}>}
 */
export async function runImport({ workouts, mapping, existingSessions, existingExercises }) {
  const map = mapping instanceof Map ? mapping : new Map();

  // ── Étape 1 : résolution du mapping / exercices à créer (hors transaction)
  const existingById = new Map();
  const byExactName  = new Map(); // nom exact → objet exercice (index unique `name`)
  for (const ex of existingExercises) {
    if (!ex || !ex.id) continue;
    existingById.set(ex.id, ex);
    if (typeof ex.name === 'string' && !byExactName.has(ex.name)) {
      byExactName.set(ex.name, ex);
    }
  }

  const created     = [];        // nouveaux exercices personnalisés à insérer
  const resolvedIds = new Map(); // nom importé → exerciseId final
  const nameById    = new Map(); // id → nom (pour exerciseName des sessions)

  /** Résout (ou crée) l'exercice cible d'un nom importé. */
  const resolveId = (name) => {
    if (resolvedIds.has(name)) return resolvedIds.get(name);

    const target = map.get(name);
    let exObj = (target && target !== 'create') ? (existingById.get(target) ?? null) : null;

    if (!exObj) {
      // 'create' (ou id introuvable) : réutilise un exercice du même nom
      // si l'index unique `name` en contient déjà un, sinon crée.
      exObj = byExactName.get(name) ?? null;
      if (!exObj) {
        exObj = {
          id:          uid(),
          name,
          category:    'barbell', // défauts du formulaire de création (exercices.js)
          muscleGroup: '',
          isCustom:    true,
          isArchived:  false,
          usageCount:  0,
          createdAt:   Date.now(),
        };
        created.push(exObj);
        byExactName.set(name, exObj); // pas de doublon au sein du lot
      }
    }

    resolvedIds.set(name, exObj.id);
    nameById.set(exObj.id, exObj.name);
    return exObj.id;
  };

  for (const name of map.keys()) resolveId(name);

  // ── Déduplication sur startTime (existantes + déjà importées dans ce lot)
  const seenTimes = new Set(existingSessions.map((s) => s.startTime));
  const toImport  = [];
  let skipped     = 0;
  for (const w of workouts) {
    if (seenTimes.has(w.startTime)) { skipped++; continue; }
    seenTimes.add(w.startTime);
    toImport.push(w);
  }

  // ── Étape 2 : construction des sessions (schéma exact de _finishSession)
  const now = Date.now();
  const sessions = toImport.map((w) => {
    const exercises = w.exercises.map((we) => {
      const exerciseId = resolveId(we.name);
      const sets = we.sets.map((s) => ({ ...s }));

      // bestSet : meilleure série (e1RM) parmi weight > 0 et reps > 0
      let bestSet = null;
      let best1RM = 0;
      for (const set of sets) {
        if (set.type === 'timer') continue;
        if (set.weight > 0 && set.reps > 0) {
          const e1rm = estimate1RM(set.weight, set.reps);
          if (e1rm > best1RM) {
            best1RM = e1rm;
            bestSet = { weight: set.weight, reps: set.reps, estimated1RM: e1rm };
          }
        }
      }

      return {
        exerciseId,
        exerciseName: nameById.get(exerciseId) ?? we.name,
        sets,
        note: we.note || '',
        bestSet,
      };
    });

    // totalVolume : Σ weight × reps des sets non-timer
    let totalVolume = 0;
    for (const ex of exercises) {
      for (const set of ex.sets) {
        if (set.type !== 'timer' && set.weight > 0 && set.reps > 0) {
          totalVolume += set.weight * set.reps;
        }
      }
    }

    return {
      id:          uid(),
      routineId:   null,
      name:        w.name || t('session.free_name'),
      startTime:   w.startTime,
      endTime:     w.startTime + w.durationSec * 1000,
      duration:    w.durationSec,
      exercises,
      totalVolume: Math.round(totalVolume * 10) / 10,
      prCount:     0, // calculé chronologiquement ci-dessous
      createdAt:   now,
    };
  });

  // ── PRs chronologiques : max courant d'e1RM par exercice sur la timeline
  //    fusionnée. Les sessions existantes alimentent le max sans être modifiées.
  const timeline = [
    ...existingSessions.map((session) => ({ session, imported: false })),
    ...sessions.map((session) => ({ session, imported: true })),
  ].sort((a, b) =>
    (a.session.startTime - b.session.startTime) || (a.imported - b.imported)
  );

  const maxByExercise = new Map(); // exerciseId → meilleur e1RM courant
  for (const { session, imported } of timeline) {
    if (!Array.isArray(session.exercises)) continue;
    let prCount = 0;

    for (const ex of session.exercises) {
      if (!ex || !Array.isArray(ex.sets)) continue;
      for (const set of ex.sets) {
        if (!set || set.type === 'timer' || !set.completed) continue;
        if (!(set.weight > 0) || !(set.reps > 0)) continue;

        const e1rm = estimate1RM(set.weight, set.reps);
        if (e1rm <= 0) continue;

        const current = maxByExercise.get(ex.exerciseId) ?? 0;
        if (imported) {
          set.isPR = e1rm > current;
          if (set.isPR) prCount++;
        }
        if (e1rm > current) maxByExercise.set(ex.exerciseId, e1rm);
      }
    }

    if (imported) session.prCount = prCount;
  }

  // ── usageCount : +1 par séance importée avec au moins un set non-timer
  const usageInc = new Map(); // exerciseId → incrément
  for (const session of sessions) {
    for (const ex of session.exercises) {
      if (ex.exerciseId && ex.sets.some((s) => s.type !== 'timer')) {
        usageInc.set(ex.exerciseId, (usageInc.get(ex.exerciseId) ?? 0) + 1);
      }
    }
  }

  const createdIds = new Set(created.map((ex) => ex.id));
  for (const ex of created) {
    ex.usageCount = (ex.usageCount || 0) + (usageInc.get(ex.id) ?? 0);
  }

  const exercisesToPut = [...created];
  for (const [id, inc] of usageInc) {
    if (createdIds.has(id)) continue;
    const existing = existingById.get(id);
    if (existing) {
      exercisesToPut.push({ ...existing, usageCount: (existing.usageCount || 0) + inc });
    }
  }

  // ── Étape 3 : écriture atomique (une seule transaction multi-stores)
  await dbTransaction(['exercises', 'sessions'], 'readwrite', (tx) => {
    const exStore   = tx.objectStore('exercises');
    const sessStore = tx.objectStore('sessions');
    for (const ex of exercisesToPut) exStore.put(ex);
    for (const session of sessions)  sessStore.put(session);
  });

  return {
    imported:         sessions.length,
    skipped,
    createdExercises: created.length,
  };
}
