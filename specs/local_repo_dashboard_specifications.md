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

### 3.5. Monitoring du Statut Online / Offline
* **Configuration des URLs :** Dans le fichier de config ou l'interface, association d'une ou plusieurs URLs de staging / production par repo (ex: `https://app-staging.domaine.fr`).
* **Ping / Health Check :** 
  * Le backend effectue un appel HTTP léger (`HEAD` ou `GET` avec timeout court) sur les URLs renseignées.
  * Affichage d'un indicateur visuel (Pastille Verte = Online / Pastille Rouge = Offline / Grise = Non configuré).
  * Rafraîchissement manuel ou périodique.

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
      }
    }
  }
}
```