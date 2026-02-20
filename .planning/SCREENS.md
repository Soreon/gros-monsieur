# Analyse des écrans — Gros Monsieur

> Analyse détaillée des 13 captures d'écran de référence.

---

## Navigation globale

**Barre de navigation basse (bottom tab bar)** — présente sur toutes les pages principales :

```
[ Profil ] [ Historique ] [ + Entraînement ] [ Exercices ] [ Mesurer ]
```

- Onglet actif : icône + texte en blanc/accent
- Onglets inactifs : icône + texte en gris
- L'onglet "Entraînement" (centre) a une icône `+` distinctive

---

## Écran 1 — Historique (`Média.png`)

**Accès** : Onglet "Historique"

### En-tête de mois
```
Février                    10 entraînements
```

### Carte de séance
```
[Nom de la séance]
[jour] [date] à [heure]

Exercices                 Meilleure série
────────────────────────────────────────
3 × Pull Up              15 reps
4 × Bent Over Row (Barbell)    100 kg × 6
3 × Lat pulldown - Close Grip  80 kg × 12
…

⏱ 1h 1m   ⚖ 12681 kg   🏆 12 PRs
```

### Comportement
- Scroll vertical infini / paginé
- Tap sur une carte → vue détail de la séance
- Groupage automatique par mois avec compte

---

## Écran 2 — Profil (`Média (1).png`)

**Accès** : Onglet "Profil"

### En-tête
```
                          ⚙
Profil

[Avatar]  Soreon           >
          255 entraînements
```

### Section Dashboard
```
Tableau de bord            [+]

┌─ Widget : Entraînements par semaine ──── ⋯ ─┐
│  ████ ████████████████ ████ ███             │
│  29/12 05/01 … 16/02 23/02                  │
│                                        0–4  │
└─────────────────────────────────────────────┘

┌─ Widget : Bench Press (Barbell) ─────── ⋯ ─┐
│  MEILLEURE SÉRIE (1RM EST.)                 │
│  ↗  ligne de progression                    │
│  145–170 kg  |  DÉC. 2025 → FÉVR. 2026     │
└─────────────────────────────────────────────┘
```

### Widgets disponibles (panel "+")
- Entraînements par semaine
- Calories cette semaine
- Macros quotidiennes
- Exercices (suivi de progression)
- Mesurer (suivi d'une métrique corporelle)

### Comportement
- Tap ⚙ → Page Paramètres
- Tap sur la ligne du profil → éditeur de profil
- Tap [+] → panel "Ajouter un widget" (slide-up)
- Tap ⋯ sur un widget → supprimer / configurer

---

## Écran 3 — Exercices (liste) (`Média (2).png`)

**Accès** : Onglet "Exercices"

### En-tête
```
Exercices
                     🔍  ⚡  ↕  ⋮
```

### Icônes en-tête
- 🔍 : Recherche (barre de recherche slide-in)
- ⚡ : Filtre par groupe musculaire
- ↕ : Tri (A-Z, Z-A, plus utilisé)
- ⋮ : Menu → "Créer un exercice" / "Afficher les archives"

### Liste alphabétique
```
A
[icône]  Ab Wheel
         Core

[A]      Aerobics
         Cardio

[icône]  Arnold Press (Dumbbell)        19
         Shoulders

[icône]  Around the World
         Chest
B
[icône]  Back Extension
         Back
…
```

Colonne droite : nombre d'utilisations dans les séances (si > 0)

### Icônes d'exercices
- Silhouettes humaines stylisées selon le type (poids, machine, corps)
- Pour Aerobics et exercices sans icône : cercle avec initiale

---

## Écran 4 — Exercices (menu ⋮ ouvert) (`Média (7).png`)

```
Exercices
                     🔍  ⚡  ↕  ⋮
                              ┌──────────────────────┐
                              │ Créer un exercice    │
                              │ Afficher les archives│
                              └──────────────────────┘
```

**Note** : Notification en bas indiquant une session en cours ("Jambes — 0:17")

---

## Écran 5 — Formulaire "Nouvel exercice" (`Média (8).png`)

**Accès** : Menu ⋮ → Créer un exercice

```
✗   Nouvel exercice              ✓

Nom
┌─────────────────────────────────┐
│ Nom de l'exercice               │
└─────────────────────────────────┘

Catégorie
┌─────────────────────────────────┐
│ Barre à disques              ⇕  │
└─────────────────────────────────┘

Partie du corps
┌─────────────────────────────────┐
│ Aucun(e)                     ⇕  │
└─────────────────────────────────┘
```

- ✗ : annuler → retour sans sauvegarder
- ✓ : valider → sauvegarder et retour

---

## Écran 6 — Modal sélection catégorie (`Média (9).png`)

**Accès** : Tap sur le select "Catégorie"

```
┌─────────────────────────────────────┐
│  Catégorie                          │
│                                     │
│  ◉ Barre à disques                  │
│  ○ Haltère                          │
│  ○ Machine/Autre                    │
│  ○ Poids corporel                   │
│  ○ Poids du corps assisté           │
│  ○ Réps uniquement                  │
│  ○ Cardio-training                  │
│  ○ Durée                            │
│                                     │
│                              [OK]   │
└─────────────────────────────────────┘
```

---

## Écran 7 — Mesurer (`Média (3).png`)

**Accès** : Onglet "Mesurer"

```
Mesurer

Poids
99.5 kg

Pourcentage de graisse corporelle

Apport calorique

────────────────
Partie du corps

Cou

Épaules

Pectoraux

Biceps gauche

Biceps droit

Avant-bras gauche

Avant-bras droit
[scroll ↓ pour la suite...]
```

### Comportement
- Tap sur une ligne → modal d'entrée de valeur + graphique historique
- Valeur affichée = dernière valeur saisie

### Métriques complètes
**Générales** : Poids, % graisse corporelle, Apport calorique
**Corps** : Cou, Épaules, Pectoraux, Biceps G, Biceps D, Avant-bras G, Avant-bras D, Taille, Hanches, Cuisse G, Cuisse D, Mollet G, Mollet D

---

## Écran 8 — Vue détail routine (`Média (4).png`)

**Accès** : Tap sur une routine dans l'onglet Entraînement

```
←   Jambes                        ⋮

Dernière : Jamais

[icône]  3 × Squat (Barbell)           ?
         Legs

[icône]  4 × Leg Press                 ?
         Legs

[icône]  2 × Leg Extension (Machine)   ?
         Legs

[icône]  3 × Stiff Leg Deadlift (Barbell) ?
         Back

[icône]  2 × Seated Leg Curl (Machine) ?
         Legs


[ COMMENCER L'ENTRAÎNEMENT ]
```

- `?` : info supplémentaire sur les séries
- Bouton plein largeur en bas → démarrer la session
- Menu ⋮ → modifier / dupliquer / supprimer la routine

---

## Écran 9 — Session active (début) (`Média (5).png`)

**Accès** : "COMMENCER L'ENTRAÎNEMENT" ou session en cours

```
↓   🔄              0:03          TERMINER

Jambes   ⋯
0:03

──────── Squat (Barbell) ─────── 🔗  ⋯ ──

SÉRIE   PRÉCÉDENT        KG      RÉPS   ✓
  1        —            [    ]  [  6 ] ☐
  2        —            [    ]  [    ] ☐
  3        —            [    ]  [    ] ☐

            + AJOUTER UNE SÉRIE

──────── Leg Press ──────────── 🔗  ⋯ ──
2 drop a chaque fois                        ← Note

┌── Écrire une note ────────────────────┐
└───────────────────────────────────────┘

SÉRIE   PRÉCÉDENT        KG      RÉPS   ✓
  1        —            [360 ]  [ 10 ] ☐
  2        —            [    ]  [  8 ] ☐
  3        —            [    ]  [    ] ☐
  D        —            [360 ]  [  8 ] ☐   ← Drop set

            + AJOUTER UNE SÉRIE
```

### Header
- `↓` : minimiser (retour aux tabs, badge timer visible)
- `🔄` : reset chrono
- `0:03` : timer HH:MM:SS
- `TERMINER` : finaliser la session

---

## Écran 10 — Session active (suite) (`Média (6).png`)

```
[Suite des exercices...]

──── Leg Extension (Machine) ── 🔗  ⋯ ──
SÉRIE   PRÉCÉDENT        KG      RÉPS   ✓
  1        —            [    ]  [ 20 ] ☐
  2        —            [    ]  [ 20 ] ☐

            + AJOUTER UNE SÉRIE

──── Stiff Leg Deadlift (Barbell) 🔗  ⋯ ─
SÉRIE   PRÉCÉDENT        KG      RÉPS   ✓
  1        —            [    ]  [    ] ☐
  2        —            [    ]  [    ] ☐
  3        —            [100 ]  [  8 ] ✓   ← Série validée

            + AJOUTER UNE SÉRIE

──── Seated Leg Curl (Machine) ─ 🔗  ⋯ ──
SÉRIE   PRÉCÉDENT        KG      RÉPS   ✓
  1        —            [    ]  [    ] ☐
  2        —            [    ]  [    ] ☐

            + AJOUTER UNE SÉRIE

            + AJOUTER UN EXERCICE

            ANNULER L'ENTRAÎNEMENT
```

---

## Écran 11 — Profil + panel widgets (`Média-_11_.png`)

```
Profil
⚙

[Avatar]  Soreon           >
          255 entraînements

Tableau de bord           [+]

[Widget entraînements/semaine visible]

────────── Ajouter un widget ──────────

Entraînements par semaine
Suivez vos entraînements terminés chaque semaine

Calories cette semaine
Calculer l'apport calorique de la semaine en cours

Macros quotidiennes
Calculer votre apport nutritionnel chaque jour

Exercices
Suivre vos progrès

Mesurer
Track a specific body metric
```

---

## Écran 12 — Paramètres (`Média-_12_.png`)

**Accès** : ⚙ depuis le Profil

```
←   Paramètres                  🔄  👑

Profil
Modifier

────────────────────────────────────────
Appearance

Thème                    Sombre automatique

────────────────────────────────────────
Entraînement

Effets sonores                          ●  (ON)
N'inclut pas d'alerte du minuteur de repos

Verrouiller les ensembles complétés     ○  (OFF)

Confirmation de suppression de l'ensemble ●  (ON)

Série précédente
Entraînements issus du même modèle uniquement

Gérer les ensembles incomplets
Demander à chaque fois

Barres disponibles

Disques disponibles

────────────────────────────────────────
Minuteur de repos

Simple Timers                           ○  (OFF)

Valeurs par défaut
[suite en dessous du scroll...]
```

---

## Résumé des transitions

| De | Vers | Action | Transition |
|---|---|---|---|
| Profil | Paramètres | Tap ⚙ | Slide right |
| Exercices | Nouvel exercice | Menu ⋮ | Modal slide-up |
| Entraînement | Détail routine | Tap routine | Slide right |
| Détail routine | Session active | Bouton démarrer | Fade / slide-up |
| Session active | Tab minimisé | Tap ↓ | Slide down |
| Profil | Panel widgets | Tap [+] | Slide-up drawer |
