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
| Charts | **Aucun dans un premier temps** (stats textuelles uniquement) |
| Icônes | **Font Awesome Pro** (kit personnel, mis en cache par le SW) |
| i18n | Système de traduction maison (fichiers de clés JS) |
| Thèmes | Clair / Sombre / Automatique (CSS custom properties + `data-theme`) |
| Langue par défaut | Français |

## Stack technique

```
HTML5
CSS3 (custom properties, grid, flexbox, data-theme attribute)
JavaScript ES6+ (modules, classes, async/await)
IndexedDB (via wrapper custom)
Service Worker (cache-first + network-fallback, cache FA Pro kit)
Web App Manifest
Font Awesome Pro (kit URL, mis en cache offline)
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
- Dashboard avec statistiques textuelles (sans graphiques dans un premier temps)
- Export/Import des données en JSON
- Thème clair / sombre / automatique (système)
- Interface multilingue (i18n — français par défaut, extensible)
- Installable comme application native (PWA)

## Design

### Thème sombre (par défaut)
- Fond : `#1c1f26` | Surface : `#252932` | Surface haute : `#2e333d`
- Accent : `#7c5cbf` (violet) | Accent hover : `#9470d6`
- Texte : `#ffffff` | Texte secondaire : `#a0a8b8`
- Danger : `#e55353` | Succès : `#4caf7d`

### Thème clair
- Fond : `#f4f5f7` | Surface : `#ffffff` | Surface haute : `#e8eaf0`
- Accent : `#7c5cbf` | Accent hover : `#6a4daa`
- Texte : `#1a1f2e` | Texte secondaire : `#5c6478`

### Bascule de thème
- Attribut `data-theme="dark|light"` sur `<html>`
- Détection automatique via `prefers-color-scheme` si réglé sur "auto"
- Persisté dans le profil utilisateur (IndexedDB)

### Typographie & layout
- Police : `system-ui` (aucune webfont)
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
│   ├── app.js                  # Point d'entrée, init, thème
│   ├── router.js               # Routeur SPA hash-based
│   ├── db.js                   # Wrapper IndexedDB
│   ├── store.js                # État global réactif (observer pattern)
│   ├── i18n.js                 # Système de traduction (t('clé'))
│   ├── data/
│   │   ├── exercises-seed.js   # ~100 exercices pré-définis
│   │   └── locales/
│   │       ├── fr.js           # Traductions françaises (défaut)
│   │       └── en.js           # Traductions anglaises (exemple)
│   ├── pages/
│   │   ├── profil.js
│   │   ├── historique.js
│   │   ├── entrainement.js
│   │   ├── session.js          # Session active (overlay)
│   │   ├── exercices.js
│   │   └── mesurer.js
│   ├── components/
│   │   ├── bottom-nav.js       # Barre de navigation basse
│   │   ├── modal.js            # Système modal générique
│   │   └── timer.js            # Timer chronomètre
│   └── utils/
│       ├── export.js           # Export/Import JSON
│       ├── pr.js               # Détection PRs
│       └── helpers.js          # Fonctions utilitaires
```

## Système i18n

Approche légère, sans librairie :

```js
// js/i18n.js
const locale = 'fr'; // lu depuis le profil utilisateur
export function t(key, vars = {}) {
  let str = translations[locale]?.[key] ?? translations['fr'][key] ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
```

```js
// js/data/locales/fr.js
export default {
  'nav.profile': 'Profil',
  'nav.history': 'Historique',
  'nav.workout': 'Entraînement',
  'nav.exercises': 'Exercices',
  'nav.measure': 'Mesurer',
  'session.finish': 'TERMINER',
  'session.cancel': 'ANNULER L\'ENTRAÎNEMENT',
  // ...
}
```

Toutes les chaînes visibles de l'UI passent par `t()`. Ajouter une langue = créer un fichier `xx.js` et l'enregistrer dans `i18n.js`.

---

## Critères de succès

- [ ] Installable sur iOS (Safari) et Android (Chrome)
- [ ] Fonctionne hors-ligne après premier chargement (FA Pro kit mis en cache)
- [ ] Score Lighthouse PWA ≥ 90
- [ ] Thème clair/sombre opérationnel sans rechargement
- [ ] Toutes les chaînes UI passent par le système i18n
- [ ] Données persistantes entre sessions
- [ ] Responsive de 375px à 1440px
