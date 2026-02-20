# Gros Monsieur — PWA de suivi fitness/musculation

## Vision du projet

Application web progressive (PWA) de suivi d'entraînement de musculation, utilisable sur mobile et PC, sans framework JS. Inspirée de l'app Hevy, elle permet de logger ses séances, suivre sa progression, et mesurer son corps.

## Contraintes techniques

| Contrainte | Décision |
|---|---|
| Framework JS | Aucun — Vanilla JS (ES6+) |
| Style | Vanilla CSS avec custom properties |
| Stockage | IndexedDB (local) + export/import JSON |
| PWA | Service Worker manuel + Web App Manifest |
| Charts | Canvas API (natif) |
| Icônes | SVG inline |
| Langue | Français |

## Stack technique

```
HTML5
CSS3 (custom properties, grid, flexbox)
JavaScript ES6+ (modules, classes, async/await)
IndexedDB (via wrapper custom)
Service Worker (cache-first + network-fallback)
Web App Manifest
Canvas API (graphiques)
```

## Fonctionnalités principales

### Navigation (bottom tab bar)
- **Profil** — tableau de bord personnalisable avec widgets
- **Historique** — log des séances passées
- **Entraînement** — gestion des routines + session active
- **Exercices** — bibliothèque d'exercices
- **Mesurer** — suivi des mesures corporelles

### Fonctionnalités clés
- Séances en temps réel avec timer
- Suivi poids/reps par série
- Affichage des performances précédentes
- Détection automatique des PR (records personnels)
- Bibliothèque ~100 exercices pré-chargés (fr)
- Création d'exercices personnalisés
- Dashboard avec graphiques (entraînements/semaine, progression)
- Export/Import des données en JSON
- Thème sombre automatique
- Installable comme application native (PWA)

## Design

- **Palette** : fond `#1c1f26`, surface `#252932`, accent `#7c5cbf` (violet), texte `#ffffff` / `#a0a8b8`
- **Typographie** : system-ui (pas de webfont externe)
- **Mobile-first** : conçu pour 375px+, adaptatif jusqu'au desktop
- **Transitions** : légères, 200-300ms

## Structure de fichiers cible

```
gros-monsieur/
├── index.html                  # Shell SPA
├── manifest.json               # PWA manifest
├── sw.js                       # Service Worker
├── .planning/                  # Fichiers de planification (ce dossier)
├── assets/
│   ├── icons/                  # Icônes PWA (192x192, 512x512)
│   └── screenshots/            # Les maquettes sources (PNG)
├── css/
│   ├── reset.css
│   ├── variables.css           # Custom properties (thème)
│   ├── layout.css              # Shell, navigation
│   ├── components.css          # Boutons, inputs, modaux, cartes
│   └── pages/
│       ├── profil.css
│       ├── historique.css
│       ├── entrainement.css
│       ├── exercices.css
│       └── mesurer.css
├── js/
│   ├── app.js                  # Point d'entrée, init
│   ├── router.js               # Routeur SPA hash-based
│   ├── db.js                   # Wrapper IndexedDB
│   ├── store.js                # État global réactif (observer pattern)
│   ├── data/
│   │   └── exercises-seed.js   # ~100 exercices pré-définis
│   ├── pages/
│   │   ├── profil.js
│   │   ├── historique.js
│   │   ├── entrainement.js
│   │   ├── session.js          # Session active (overlay)
│   │   ├── exercices.js
│   │   └── mesurer.js
│   ├── components/
│   │   ├── bottom-nav.js       # Barre de navigation basse
│   │   ├── chart.js            # Graphiques Canvas
│   │   ├── modal.js            # Système modal générique
│   │   └── timer.js            # Timer chronomètre
│   └── utils/
│       ├── export.js           # Export/Import JSON
│       ├── pr.js               # Détection PRs
│       └── helpers.js          # Fonctions utilitaires
```

## Critères de succès

- [ ] Installable sur iOS (Safari) et Android (Chrome)
- [ ] Fonctionne hors-ligne après premier chargement
- [ ] Score Lighthouse PWA ≥ 90
- [ ] Aucune dépendance externe (zéro npm, zéro CDN)
- [ ] Données persistantes entre sessions
- [ ] Responsive de 375px à 1440px
