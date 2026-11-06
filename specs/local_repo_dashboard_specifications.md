# Spécifications Fonctionnelles et Techniques : Local Repo Dashboard

## 1. Objectif du projet
Créer une application web locale open source (disponible sur GitHub) permettant de centraliser la gestion, le suivi des versions, l'état Git, le diagnostic des dépendances et le monitoring de déploiement de plusieurs répertoires locaux sur la machine du développeur.

---

## 2. Stack Technique Suggérée
* **Backend (API locale / Daemon) :** Node.js avec Express ou Fastify, couplé à `simple-git` pour les opérations Git et `fs/promises` pour la lecture des fichiers.
* **Frontend :** React + Vite avec TypeScript (sans framework CSS lourd, styles en CSS/SCSS natif).
* **Stockage de configuration local :** Fichier `config.json` stocké dans le répertoire utilisateur (ex: `~/.config/local-repo-dashboard/config.json`).

---

## 3. Fonctionnalités Détaillées

### 3.1. Découverte et Scan des Répertoires Locaux
* **Configuration du dossier racine :** L'utilisateur renseigne un ou plusieurs chemins de dossiers parents (ex: `/home/user/Projets/`).
* **Scan automatique :** L'application parcourt récursivement le dossier racine pour détecter tous les sous-dossiers contenant un dossier `.git`.
* **Affichage de la liste :** Tableau ou grille listant tous les répos détectés avec :
  * Nom du projet et chemin absolu.
  * Statut Git global (modifications non commitées, fichiers non suivis, etc.).

### 3.2. Inspection des Versions (`package.json`)
* **Lecture multi-branches :** 
  * Lecture du fichier `package.json` de la branche active (`HEAD`).
  * Capacité à lire ou comparer les versions présentes sur les branches `main` et `develop` (via lecture directe des fichiers ou inspection des arbres git locaux sans forcément basculer de branche en permanence).
* **Affichage :** Badge clair indiquant le numéro de version (`version`) pour `develop` et `main` côte à côte pour chaque repo.

### 3.3. Diagnostic des Dépendances et Visualiseur `package.json`
* **Visualiseur de `package.json` :** Une modale ou un panneau latéral pour inspecter le contenu du `package.json` du repo sélectionné.
* **Audit de versions (Outdated Check) :** 
  * Un bouton **"Lancer le diagnostic"** par repo (ou global).
  * Exécution en arrière-plan d'une commande type `npm outdated` (ou équivalent compatible `pnpm` / `yarn` selon le gestionnaire détecté via la présence de `pnpm-lock.yaml`, `package-lock.json`, etc.).
  * Affichage sous forme de tableau des dépendances nécessitant une mise à jour (version actuelle vs version latest/wanted).

### 3.4. Actions Git en 1 Clic
Pour chaque dépôt de la liste, mise à disposition de boutons d'action rapide :
* **Fetch All :** Exécute un `git fetch --all --prune` en arrière-plan avec retour visuel de succès/erreur.
* **Push Sélectif :** 
  * Bouton direct pour pousser la branche `main` ou `develop`.
  * Menu déroulant ou modale permettant de choisir une autre branche locale à pousser vers le remote (`origin`).

### 3.5. Monitoring du Déploiement de l'App
* **Statut Online / Offline :**
  * **Configuration des URLs :** Dans le fichier de config ou l'interface, association d'une ou plusieurs URLs de staging / production par repo (ex: `https://app-staging.domaine.fr`).
  * **Ping / Health Check :** 
    * Le backend effectue un appel HTTP léger (`HEAD` ou `GET` avec timeout court) sur les URLs renseignées.
    * Affichage d'un indicateur visuel (Pastille Verte = Online / Pastille Rouge = Offline / Grise = Non configuré).
    * Rafraîchissement manuel ou périodique.
* **Lien vers l'hébergeur :**
  * Association, par repo (et par environnement), d'un lien vers la console de l'hébergeur (ex: Vercel, Netlify, OVH, AWS, Scaleway…).
  * Affichage d'un bouton / icône d'accès direct ouvrant le lien dans un nouvel onglet.
* **Analyse des workflows présents dans les repos :**
  * Détection des fichiers de workflow CI/CD du repo (ex: `.github/workflows/*.yml`, `.gitlab-ci.yml`).
  * Lecture et analyse du contenu : nom du workflow, événements déclencheurs (`push`, `pull_request`, `schedule`…), branches ciblées, jobs et étapes de déploiement identifiés.
  * Affichage sous forme de liste ou de tableau par repo, avec indication des repos sans workflow.

### 3.6. App — Monitoring des Erreurs (v2)
* Remontée et centralisation des erreurs applicatives des apps déployées (staging / production).
* Affichage par repo : nombre d'erreurs, dernières erreurs, fréquence et évolution dans le temps.
* Source des données : la balise (voir 3.8). Autres sources possibles à étudier (ex: outil tiers type Sentry, lecture de logs).

### 3.7. App — Monitoring des Ressources (v2)
* Suivi de la consommation des ressources des apps déployées : CPU, mémoire, stockage, bande passante.
* Affichage par repo / environnement avec indicateurs visuels et historique.
* Source des données : la balise (voir 3.8) pour l'état du process (mémoire, retard de la boucle d'événements). Autres sources possibles à étudier (ex: API de l'hébergeur).

### 3.8. Balises : package à intégrer dans les apps (v2)
Package optionnel (ex: `@pulsepit/beacon`, dans `packages/`) à ajouter aux apps suivies. Il expose l'état de l'app et des signaux de sécurité à Pulsepit. Pulsepit continue de fonctionner sans balise, avec le simple ping de 3.5.

* **Intégration :** middleware en une ligne pour Express, Fastify, Next ou `http` natif.
* **Mode de communication :** pull. La balise expose un endpoint (ex: `/__pulsepit`) que Pulsepit interroge, car une app en production ne peut pas envoyer de données vers une machine locale. Un push vers `localhost` en dev et un flux SSE pour le temps réel pourront venir plus tard.
* **Données remontées (v1) :**
  * Identité : version, SHA du commit, version de Node, environnement, uptime. Permet de comparer le déployé à `main`.
  * Santé : mémoire, retard de la boucle d'événements, checks personnalisés (ex: « la base répond »).
  * Trafic et erreurs : compteurs glissants par code HTTP (2xx, 4xx, 5xx), nombre d'erreurs non gérées et dernière stack.
  * Signaux de sécurité.
* **Signaux de sécurité :** ce sont des heuristiques à seuil réglable, affichées comme « à regarder » et non comme une protection ou une détection fiable. Faux positifs possibles.
  * Rafale de 401/403 sur une même route (force brute).
  * Balayage de chemins connus (`/.env`, `/.git`, `/wp-admin`, `/phpmyadmin`).
  * Pic de requêtes depuis une même IP.
  * Motifs évidents dans l'URL (`../`, `' OR 1=1`), marqués faible confiance.
* **Garde-fous :**
  * La balise ne bloque jamais une requête et ne fait jamais planter l'app. En cas d'échec, elle se tait.
  * Mémoire bornée (fenêtres glissantes, pas d'historique infini).
  * Aucune donnée personnelle : pas de corps de requête ni d'en-têtes sensibles, IP tronquée ou hachée.
  * L'endpoint est une surface d'attaque : token obligatoire, désactivé par défaut hors dev, aucune information exploitable (pas de variables d'environnement, pas de chemins internes).
* **Affichage dans Pulsepit :** état de balise par repo (allumée, silencieuse, signal de sécurité) et onglet « Signaux ».
* **Exemple de réponse de l'endpoint :**

```json
{
  "app": { "name": "mon-app", "version": "2.4.0", "commit": "48c5fe0", "env": "production", "node": "22.11.0", "uptimeSeconds": 86400 },
  "health": {
    "memoryMb": 182,
    "eventLoopLagMs": 4,
    "checks": { "database": "ok" }
  },
  "traffic": {
    "windowSeconds": 300,
    "status": { "2xx": 1204, "4xx": 37, "5xx": 2 },
    "unhandledErrors": 1,
    "lastError": { "message": "Cannot read properties of undefined", "at": "2026-10-19T09:41:12Z" }
  },
  "signals": [
    { "type": "bruteforce", "route": "/api/login", "count": 48, "windowSeconds": 60, "confidence": "medium" },
    { "type": "path-scan", "samples": ["/.env", "/wp-admin"], "count": 12, "confidence": "high" }
  ]
}
```

---

## 4. Structure du Fichier de Configuration (`config.json`)

```json
{
  "scanPaths": [
    "/home/user/Projets"
  ],
  "repositories": {
    "/home/user/Projets/mon-app": {
      "name": "Mon App",
      "urls": {
        "production": "https://app.domaine.fr",
        "staging": "https://staging.domaine.fr"
      },
      "hosting": {
        "production": "https://console.hebergeur.com/projects/mon-app",
        "staging": "https://console.hebergeur.com/projects/mon-app-staging"
      },
      "beacon": {
        "production": { "url": "https://app.domaine.fr/__pulsepit", "tokenEnv": "PULSEPIT_TOKEN_MON_APP" }
      }
    }
  }
}
```