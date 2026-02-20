# Modèle de données — Gros Monsieur

> Stockage : IndexedDB, base nommée `gros-monsieur-db` v1.
> Tous les timestamps sont des nombres (Date.now()).
> Les IDs sont des chaînes générées par `crypto.randomUUID()`.

---

## Object Stores

### 1. `exercises` — Bibliothèque d'exercices

```js
{
  id: string,           // uuid
  name: string,         // "Squat (Barbell)"
  category: string,     // voir énumération ci-dessous
  muscleGroup: string,  // voir énumération ci-dessous
  isCustom: boolean,    // false = exercice du seed
  isArchived: boolean,  // true = masqué de la liste principale
  usageCount: number,   // incrémenté à chaque utilisation en session
  createdAt: number,    // timestamp
}
```

**Valeurs `category`** :
| Clé | Libellé FR |
|---|---|
| `barbell` | Barre à disques |
| `dumbbell` | Haltère |
| `machine` | Machine/Autre |
| `bodyweight` | Poids corporel |
| `assisted_bodyweight` | Poids du corps assisté |
| `reps_only` | Réps uniquement |
| `cardio` | Cardio-training |
| `duration` | Durée |

**Valeurs `muscleGroup`** :
| Clé | Libellé FR |
|---|---|
| `chest` | Pectoraux |
| `back` | Dos |
| `shoulders` | Épaules |
| `biceps` | Biceps |
| `triceps` | Triceps |
| `forearms` | Avant-bras |
| `legs` | Jambes |
| `glutes` | Fessiers |
| `core` | Abdos / Core |
| `full_body` | Corps entier |
| `cardio` | Cardio |
| `other` | Autre |

**Index** : `name` (unique), `muscleGroup`, `isArchived`

---

### 2. `routines` — Modèles de séances

```js
{
  id: string,
  name: string,           // "Jambes", "Push A", etc.
  exercises: [
    {
      exerciseId: string,
      sets: [
        {
          type: string,   // 'normal' | 'warmup' | 'drop'
          reps: number,   // reps cibles (0 = non défini)
          weight: number, // poids en kg (0 = poids de corps)
        }
      ],
      note: string,       // note libre sur l'exercice
    }
  ],
  lastUsedAt: number | null, // timestamp de la dernière utilisation
  createdAt: number,
  updatedAt: number,
}
```

**Index** : `lastUsedAt`

---

### 3. `sessions` — Séances enregistrées

```js
{
  id: string,
  routineId: string | null,   // null si séance libre
  name: string,               // nom de la séance (copié depuis la routine)
  startTime: number,          // timestamp début
  endTime: number,            // timestamp fin
  duration: number,           // secondes (endTime - startTime)
  totalVolume: number,        // kg total soulevé (somme poids × reps séries complétées)
  prCount: number,            // nombre de PRs dans cette séance
  exercises: [
    {
      exerciseId: string,
      exerciseName: string,   // dénormalisé pour l'affichage historique
      sets: [
        {
          type: string,       // 'normal' | 'warmup' | 'drop'
          weight: number,     // kg
          reps: number,
          completed: boolean,
          isPR: boolean,      // record personnel sur cet exercice
        }
      ],
      note: string,
      bestSet: {              // calculé à la fin de la séance
        weight: number,
        reps: number,
        estimated1RM: number, // Formule Epley : weight × (1 + reps / 30)
      } | null,
    }
  ],
  createdAt: number,
}
```

**Index** : `startTime`, `routineId`

---

### 4. `measurements` — Mesures corporelles

```js
{
  id: string,
  type: string,     // voir énumération ci-dessous
  value: number,    // valeur numérique
  unit: string,     // 'kg' | '%' | 'kcal' | 'cm'
  date: number,     // timestamp (date de la mesure)
  createdAt: number,
}
```

**Valeurs `type`** :

| Clé | Libellé FR | Unité |
|---|---|---|
| `weight` | Poids | kg |
| `body_fat` | % graisse corporelle | % |
| `calories` | Apport calorique | kcal |
| `neck` | Cou | cm |
| `shoulders` | Épaules | cm |
| `chest` | Pectoraux | cm |
| `bicep_left` | Biceps gauche | cm |
| `bicep_right` | Biceps droit | cm |
| `forearm_left` | Avant-bras gauche | cm |
| `forearm_right` | Avant-bras droit | cm |
| `waist` | Taille | cm |
| `hips` | Hanches | cm |
| `thigh_left` | Cuisse gauche | cm |
| `thigh_right` | Cuisse droite | cm |
| `calf_left` | Mollet gauche | cm |
| `calf_right` | Mollet droit | cm |

**Index** : `type`, `date`

---

### 5. `profile` — Profil utilisateur (singleton)

```js
{
  id: 'singleton',          // clé fixe, un seul objet
  name: string,             // "Soreon"
  avatarInitials: string,   // initiales pour l'avatar (ex: "S")
  totalWorkouts: number,    // dénormalisé, incrémenté à chaque session
  theme: string,            // 'dark' | 'light' | 'auto'
  settings: {
    soundEffects: boolean,          // effets sonores (hors minuteur)
    lockCompletedSets: boolean,     // verrouiller les séries complétées
    confirmDeleteSet: boolean,      // confirmer avant suppression de série
    previousSets: string,           // 'same_routine' | 'any'
    manageIncompleteSets: string,   // 'ask' | 'keep' | 'delete'
    availableBars: [                // barres disponibles
      { name: string, weight: number } // ex: { name: "Standard", weight: 20 }
    ],
    availablePlates: [              // disques disponibles (paires)
      { weight: number, count: number }
    ],
    restTimer: {
      simpleTimers: boolean,
      defaultSeconds: number,       // ex: 90
    },
  },
  dashboardWidgets: [               // ordre des widgets du tableau de bord
    {
      id: string,                   // 'weekly_workouts' | 'exercise_progress' | 'calories' | 'macros' | 'measure'
      config: {
        exerciseId?: string,        // pour widget exercise_progress
        measureType?: string,       // pour widget measure
      }
    }
  ],
  createdAt: number,
  updatedAt: number,
}
```

---

## Format Export JSON

```json
{
  "version": 1,
  "exportedAt": 1708448400000,
  "profile": { ... },
  "exercises": [ ... ],
  "routines": [ ... ],
  "sessions": [ ... ],
  "measurements": [ ... ]
}
```

---

## Règles métier

### Calcul du volume total
```
volume = Σ (set.weight × set.reps) pour toutes les séries completed = true
```

### Calcul 1RM estimé (formule Epley)
```
1RM = weight × (1 + reps / 30)
```

### Détection PR (record personnel)
Un PR est détecté si le `estimated1RM` de la série dépasse le maximum historique pour cet exercice.

### Série précédente
Lors d'une session, chaque série affiche les valeurs de la même position dans la session précédente où cet exercice apparaît (selon le paramètre `previousSets` : même routine uniquement ou toutes).

---

## Initialisation de la base

Au premier lancement (`onupgradeneeded`) :
1. Création de tous les object stores avec leurs index
2. Insertion du profil par défaut (`id: 'singleton'`)
3. Insertion des ~100 exercices du seed (`isCustom: false`)
4. Création d'une routine exemple ("Full Body Débutant")
