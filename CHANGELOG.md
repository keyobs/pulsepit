# Changelog

Toutes les évolutions notables de Pulsepit. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

Le package `@keyobs/pulsepit-beacon` a sa propre version (actuellement 0.1.1).

## [0.2.0] — 2026-11-06

### Ajouté

**Dépendances**
- Bouton « Installer les dépendances » dans l'onglet Dépendances : lance `npm install`, `pnpm install` ou `yarn install` dans le dépôt local, selon le gestionnaire détecté (route `POST /api/repositories/install`, délai de 5 min, une seule installation à la fois par dépôt).
- Inventaire complet des paquets du `package.json` racine : version déclarée, installée, souhaitée et dernière, avec un statut `à jour`, `obsolète` ou `privé`.
- Paquets privés (scope associé à un registre autre que npm ou Yarn dans `.npmrc`) exclus du diagnostic : leur registre n'est pas interrogé.
- Versions de Node et du gestionnaire déclarées par le dépôt (`.nvmrc`, `.node-version`, `volta`, `engines`, `packageManager`), avec leur source.
- Diagnostic Yarn Classic, en plus de npm, pnpm et Yarn moderne.
- Erreurs de registre explicites : identifiants absents ou refusés, accès interdit, DNS, connexion, TLS, délai, indisponibilité et limitation de débit (HTTP 429), avec une date de nouvel essai qui désactive le bouton de diagnostic jusqu'à son échéance.

**Git**
- Verrou de push par dépôt, par branche ou global, réglable depuis l'onglet Git et les réglages.
- Politiques de push par branche, versionnées dans le dépôt, et adaptateur pre-push partagé.
- Contrôles longs (lint, tests…) lancés et suivis depuis l'onglet Git, avec historique conservé entre les redémarrages et réutilisation des contrôles vérifiés au moment du push.
- Inventaire des hooks Git (dont Husky et les worktrees), et refus de push par un hook local distingués des refus du remote.
- Date de dernière activité par dépôt, et tri des dépôts par activité récente.

**Réglages**
- Fenêtre de réglages persistés côté serveur : dossiers scannés, fetch périodique de tous les dépôts, verrous de push.
- Rechargement de la liste des dépôts après chaque fetch périodique.

**Déploiements et balise**
- Cartes par environnement avec ping ciblé, version et commit déployés, écart avec la branche configurée.
- Dates de déploiement lues depuis GitHub Pages et Vercel.
- Package `@keyobs/pulsepit-beacon` (métadonnées de déploiement statiques), indicateur de balise par dépôt et onglet Balise.
- Surveillance périodique des balises, avec état affiché sur les cartes de déploiement.

**Interface**
- Liste des dépôts avec lignes, panneau de détail et barre de résumé.
- Action « Ouvrir dans l'éditeur » sur chaque dépôt.

### Modifié
- Services de l'API regroupés par domaine.
- Les commandes Git et des gestionnaires de paquets s'exécutent avec un environnement filtré.
- Les requêtes GET identiques et simultanées partagent un seul appel.

### Corrigé
- Avertissements pnpm autour du rapport JSON d'`outdated` tolérés.
- Réglages Git de confiance pris en compte par les clients Git protégés.

## [0.1.0] — 2026-10-21

Version initiale.

- Scan des dossiers configurés (y compris les sous-dossiers) et liste des dépôts : branche, synchronisation avec l'upstream, remote `origin`, gestionnaire de paquets et `engines`.
- Fetch, liste des branches locales et push d'une branche vers `origin`.
- Diagnostic des dépendances obsolètes (npm, pnpm, Yarn moderne) et lecture du `package.json` (HEAD, `main`, `develop`).
- URLs de déploiement par environnement, ping à la demande et liens vers la console de l'hébergeur.
- Détection et analyse des workflows GitHub Actions et GitLab CI.
- Package `@pulsepit/contracts` : schémas Zod partagés entre le front et l'API.
- Socle du front : client API typé, composants, hooks et notifications.
