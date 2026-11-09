export const API_BASE = '/api';

/** Délai maximal d'une requête ordinaire (le back limite fetch et push à 30 s). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Le diagnostic des dépendances est limité à 90 s côté back. */
export const OUTDATED_REQUEST_TIMEOUT_MS = 120_000;

/** Le scan enrichit les dépôts un par un et n'a pas de délai global côté back. */
export const LIST_REQUEST_TIMEOUT_MS = 180_000;

/** L'install est limitée à 5 min côté back. */
export const INSTALL_REQUEST_TIMEOUT_MS = 330_000;

/** Requêtes simultanées maximum pour les actions de masse (convenu avec le back, CONVENTION.md § 7.6). */
export const BULK_REQUEST_LIMIT = 3;
