# Gros Monsieur

Application PWA de suivi d'entraînement fitness et musculation.

**Demo :** [soreon.github.io/gros-monsieur](https://soreon.github.io/gros-monsieur/)

---

## Fonctionnalités

- **Bibliothèque d'exercices** — +100 exercices pré-chargés (barre, haltère, machine, poids de corps, cardio), filtres, recherche, création d'exercices personnalisés
- **Routines** — création et édition de routines d'entraînement réutilisables
- **Session active** — timer en temps réel, log des séries (kg × reps), détection automatique des PRs, minuteur de repos configurable, minimisation en barre flottante
- **Historique** — séances groupées par mois, vue détail, suppression
- **Mesures corporelles** — suivi du poids et de 13 mensurations avec historique
- **Tableau de bord** — widgets personnalisables (entraînements/semaine, progression exercice, calories, mesures)
- **Paramètres** — thème clair/sombre/automatique, langue (FR/EN), export/import JSON

## Stack technique

- Vanilla JS ES6+ (modules, pas de framework)
- CSS custom properties (thème dynamique)
- IndexedDB (persistance locale via wrapper interne)
- Service Worker — cache-first, offline intégral
- PWA — installable sur Android et iOS

## Structure

```
├── index.html
├── manifest.json
├── sw.js
├── css/
│   ├── variables.css     — design tokens (couleurs, espacements, typo…)
│   ├── reset.css
│   ├── layout.css        — shell, navigation, modaux, toasts
│   ├── components.css    — boutons, inputs, cartes, badges…
│   └── pages/            — styles spécifiques à chaque page
└── js/
    ├── app.js            — point d'entrée, thème, init
    ├── router.js         — routeur SPA hash-based
    ├── i18n.js           — internationalisation (t(key))
    ├── db.js             — wrapper IndexedDB
    ├── store.js          — état global (observer pattern)
    ├── components/
    │   └── bottom-nav.js
    ├── data/
    │   ├── exercises-seed.js
    │   └── locales/      — fr.js, en.js
    ├── pages/            — profil, historique, entrainement, session, exercices, mesurer
    └── utils/            — helpers.js, export.js
```

## Lancement local

Serveur HTTP requis (modules ES6 bloqués en `file://`) :

```bash
npx serve .
# ou
python -m http.server 8080
```

## Déploiement

Le projet se déploie automatiquement sur GitHub Pages via la branche `master`.

Pour forcer la mise à jour du Service Worker chez les utilisateurs, bumper `CACHE_VERSION` dans `sw.js`.

## Données

Toutes les données sont stockées localement dans IndexedDB (aucun serveur, aucun compte).
Export/import JSON disponible depuis les paramètres.
