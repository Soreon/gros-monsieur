# Roadmap — Gros Monsieur

> Chaque phase se termine par un commit atomique.
> Statuts : 🔲 À faire | 🔄 En cours | ✅ Terminé

---

## Phase 1 — Fondations & Shell PWA
**Commit** : `feat: fondations PWA — shell, navigation, thème, routeur`

### Objectif
Poser les bases techniques de l'app : structure HTML, système de thème, navigation et routing SPA, manifest PWA et service worker minimal.

### Tâches
- [ ] Créer `index.html` — shell SPA avec zones de contenu
- [ ] Créer `css/variables.css` — custom properties (couleurs, espacements, transitions)
- [ ] Créer `css/reset.css` — reset CSS minimal
- [ ] Créer `css/layout.css` — layout principal, bottom nav, zone de contenu
- [ ] Créer `css/components.css` — composants de base (boutons, inputs, cartes)
- [ ] Créer `js/router.js` — routeur hash-based (#/profil, #/historique, etc.)
- [ ] Créer `js/app.js` — initialisation de l'app
- [ ] Créer `manifest.json` — nom, icônes, couleurs PWA
- [ ] Créer `sw.js` — service worker (cache shell)
- [ ] Créer `js/components/bottom-nav.js` — barre de navigation 5 onglets
- [ ] Générer icônes PWA (192×192, 512×512) — placeholders SVG

### Résultat attendu
Shell navigable avec les 5 onglets fonctionnels (pages vides), installable comme PWA, thème sombre appliqué.

---

## Phase 2 — Couche données (IndexedDB)
**Commit** : `feat: couche données — IndexedDB, modèles, seed exercices`

### Objectif
Mettre en place la persistance locale, les modèles de données, et pré-remplir la bibliothèque d'exercices.

### Tâches
- [ ] Créer `js/db.js` — wrapper IndexedDB (open, get, put, delete, getAll, query)
- [ ] Définir les object stores : `exercises`, `routines`, `sessions`, `measurements`, `profile`
- [ ] Créer `js/store.js` — état global réactif (observer pattern simple)
- [ ] Créer `js/data/exercises-seed.js` — ~100 exercices (nom FR, catégorie, groupe musculaire)
- [ ] Créer `js/utils/helpers.js` — fonctions utilitaires (dates, formatage, uid)
- [ ] Créer `js/utils/export.js` — export JSON + import JSON avec validation

### Seed exercices (catégories)
| Catégorie | Exemples |
|---|---|
| Barre à disques | Squat, Bench Press, Deadlift, Military Press, Bent Over Row |
| Haltère | Bicep Curl, Tricep Extension, Lateral Raise, Dumbbell Fly |
| Machine / Autre | Leg Press, Leg Extension, Lat Pulldown, Cable Row |
| Poids corporel | Pull-up, Dip, Push-up, Ab Wheel, Plank |
| Cardio | Tapis de course, Vélo, Rameur, Corde à sauter |
| Durée | Gainage, Planche latérale |

### Résultat attendu
Base de données initialisée au premier lancement, 100 exercices disponibles, export/import JSON fonctionnel.

---

## Phase 3 — Page Exercices
**Commit** : `feat: page exercices — liste, recherche, création`

### Objectif
Implémenter la bibliothèque d'exercices complète avec navigation alphabétique, filtres et création.

### Tâches
- [ ] Créer `js/pages/exercices.js` — page principale
- [ ] Créer `css/pages/exercices.css`
- [ ] Liste exercices groupée par lettre (A, B, C…) avec icônes de silhouette par groupe musculaire
- [ ] Barre de recherche (filtre en temps réel)
- [ ] Filtre par groupe musculaire (modal/drawer)
- [ ] Tri (A-Z, Z-A, le plus utilisé)
- [ ] Menu contextuel (⋮) : Créer un exercice, Afficher les archives
- [ ] Formulaire "Nouvel exercice" (modal ou page)
  - Champ nom
  - Select catégorie (Barre à disques, Haltère, Machine/Autre, Poids corporel, Poids du corps assisté, Réps uniquement, Cardio-training, Durée)
  - Select partie du corps
  - Bouton valider ✓ / annuler ✗
- [ ] Modal sélection catégorie avec radio buttons
- [ ] Archiver / désarchiver un exercice
- [ ] Affichage du nombre d'utilisations par exercice

### Résultat attendu
Bibliothèque d'exercices navigable, filtrable, avec création d'exercices personnalisés.

---

## Phase 4 — Page Entraînement — Routines
**Commit** : `feat: routines — liste, création, édition`

### Objectif
Permettre la gestion des routines d'entraînement (modèles de séances).

### Tâches
- [ ] Créer `js/pages/entrainement.js` — page principale (liste des routines)
- [ ] Créer `css/pages/entrainement.css`
- [ ] Liste des routines avec : nom, date dernière utilisation, liste courte des exercices
- [ ] Bouton créer une routine
- [ ] Formulaire création/édition routine :
  - Nom de la routine
  - Ajouter exercices depuis la bibliothèque
  - Pour chaque exercice : configurer les séries (type, nb séries)
  - Réordonner les exercices (drag ou boutons ↑↓)
  - Supprimer un exercice
- [ ] Vue détail routine :
  - Nom, "Dernière : jamais" / date
  - Liste exercices avec nb×type de séries
  - Bouton "COMMENCER L'ENTRAÎNEMENT"
  - Menu (⋮) : modifier, dupliquer, supprimer

### Résultat attendu
Création et gestion de routines d'entraînement complètes.

---

## Phase 5 — Session d'entraînement active
**Commit** : `feat: session active — timer, log séries, PRs`

### Objectif
L'écran central de l'app : logger une séance en temps réel.

### Tâches
- [ ] Créer `js/pages/session.js` — overlay plein écran sur la navigation
- [ ] Header session :
  - Bouton minimiser (retour aux tabs avec badge timer)
  - Bouton reset chrono 🔄
  - Timer HH:MM:SS en temps réel
  - Bouton "TERMINER"
- [ ] Nom de la séance + timer secondaire
- [ ] Pour chaque exercice :
  - Nom cliquable (lien vers fiche exercice)
  - Icône lien 🔗 + menu ⋮
  - Note optionnelle (textarea)
  - Tableau séries : Série | Précédent | KG | Réps | ✓
  - Champs KG et Réps : input numérique (clavier num)
  - Colonne "Précédent" : valeur de la dernière fois (même routine)
  - Checkbox validation de série → ligne barrée / colorée
  - Bouton "+ AJOUTER UNE SÉRIE"
  - Séries de type : normale, warmup (W), drop set (D)
- [ ] Bouton "+ AJOUTER UN EXERCICE" (picker depuis bibliothèque)
- [ ] Bouton "ANNULER L'ENTRAÎNEMENT" (confirmation)
- [ ] Finish : calcul volume total, durée, détection PRs
- [ ] Créer `js/components/timer.js` — chronomètre
- [ ] Créer `js/utils/pr.js` — détection records (meilleure série = plus haute charge × reps)

### Résultat attendu
Logging complet d'une séance avec timer, séries validables, et sauvegarde en base.

---

## Phase 6 — Page Historique
**Commit** : `feat: historique — log séances, détail, stats`

### Objectif
Afficher l'historique des séances passées avec stats et détails.

### Tâches
- [ ] Créer `js/pages/historique.js`
- [ ] Créer `css/pages/historique.css`
- [ ] Liste séances groupées par mois (header "Février — 10 entraînements")
- [ ] Carte séance :
  - Nom + date + heure
  - Liste exercices : `3 × Squat (Barbell)` | meilleure série à droite
  - Footer : ⏱ durée | ⚖ volume total kg | 🏆 nb PRs
- [ ] Vue détail séance (tap/click sur carte)
  - Même info + toutes les séries détaillées
  - Bouton supprimer la séance
- [ ] Affichage PRs sur les séries (badge)

### Résultat attendu
Historique complet et lisible des entraînements.

---

## Phase 7 — Page Mesurer
**Commit** : `feat: mesurer — poids, mesures corporelles, historique`

### Objectif
Suivi des mesures corporelles avec historique.

### Tâches
- [ ] Créer `js/pages/mesurer.js`
- [ ] Créer `css/pages/mesurer.css`
- [ ] Section métriques générales :
  - Poids (kg)
  - % graisse corporelle
  - Apport calorique
- [ ] Section mesures corporelles :
  - Cou, Épaules, Pectoraux, Biceps gauche, Biceps droit, Avant-bras gauche, Avant-bras droit, Taille, Hanches, Cuisse gauche, Cuisse droite, Mollet gauche, Mollet droit
- [ ] Tap sur une métrique → modal d'entrée + historique (mini-graphique)
- [ ] Historique des entrées (liste datée)
- [ ] Mini-graphique évolution (Canvas)

### Résultat attendu
Suivi complet des mesures avec historique visuel.

---

## Phase 8 — Page Profil & Dashboard
**Commit** : `feat: profil — dashboard widgets, graphiques`

### Objectif
Page d'accueil personnalisable avec stats et graphiques.

### Tâches
- [ ] Créer `js/pages/profil.js`
- [ ] Créer `css/pages/profil.css`
- [ ] Créer `js/components/chart.js` — moteur graphiques Canvas
- [ ] Header profil : avatar (initiales par défaut), nom, nombre total d'entraînements
- [ ] Bouton ⚙ → paramètres
- [ ] Section "Tableau de bord" avec bouton + (ajouter widget)
- [ ] Widgets disponibles :
  - **Entraînements par semaine** : bar chart (8 semaines)
  - **Progression exercice** : line chart (1RM estimé ou meilleure série)
  - **Calories cette semaine**
  - **Macros quotidiennes**
  - **Mesurer** : valeur actuelle d'une métrique
- [ ] Panel "Ajouter un widget" (liste des widgets disponibles)
- [ ] Suppression de widget (bouton ⋮ ou swipe)
- [ ] Persistance de la configuration du dashboard

### Résultat attendu
Dashboard personnalisable avec graphiques fonctionnels.

---

## Phase 9 — Paramètres
**Commit** : `feat: paramètres — profil, thème, préférences`

### Objectif
Page de configuration complète.

### Tâches
- [ ] Créer une page paramètres accessible via ⚙ sur le Profil
- [ ] Section Profil : modifier nom
- [ ] Section Apparence : sélecteur de thème (Sombre / Clair / Automatique)
- [ ] Section Entraînement :
  - Toggle effets sonores
  - Toggle verrouiller les ensembles complétés
  - Toggle confirmation de suppression d'ensemble
  - Sélection "Série précédente" (même routine uniquement / tous)
  - Sélection "Gérer les ensembles incomplets" (toujours demander / conserver / supprimer)
  - Barres disponibles (liste des barres avec poids)
  - Disques disponibles (liste des disques)
- [ ] Section Minuteur de repos :
  - Toggle Simple Timers
  - Valeurs par défaut (durée en secondes)
- [ ] Section Données :
  - Bouton "Exporter mes données (JSON)"
  - Bouton "Importer des données (JSON)"

### Résultat attendu
Toutes les préférences persistées et appliquées en temps réel.

---

## Phase 10 — PWA avancée & polish final
**Commit** : `feat: PWA avancée, animations, optimisations`

### Objectif
Rendre l'app vraiment native : cache offline, install prompt, polish UI.

### Tâches
- [ ] Service Worker complet :
  - Cache-first pour assets statiques (shell, CSS, JS)
  - Network-fallback pour ressources dynamiques
  - Stratégie de mise à jour (skipWaiting + clients.claim)
- [ ] Prompt d'installation (beforeinstallprompt)
- [ ] Animations de transition entre pages (slide)
- [ ] Pull-to-refresh (historique)
- [ ] Scroll restoration entre navigation
- [ ] Keyboard numérique sur inputs kg/reps
- [ ] Haptic feedback (vibration API) sur validation de série
- [ ] Score Lighthouse PWA ≥ 90
- [ ] Test sur iOS Safari + Android Chrome
- [ ] README.md final

---

## Résumé des phases

| Phase | Contenu | Commit |
|---|---|---|
| 1 | Shell + Navigation + PWA base | `feat: fondations PWA` |
| 2 | IndexedDB + Modèles + Seed | `feat: couche données` |
| 3 | Page Exercices | `feat: page exercices` |
| 4 | Routines | `feat: routines` |
| 5 | Session active | `feat: session active` |
| 6 | Historique | `feat: historique` |
| 7 | Mesures corporelles | `feat: mesurer` |
| 8 | Profil + Dashboard | `feat: profil dashboard` |
| 9 | Paramètres | `feat: paramètres` |
| 10 | PWA avancée + polish | `feat: PWA polish` |
