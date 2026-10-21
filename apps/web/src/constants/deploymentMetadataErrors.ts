export const DEPLOYMENT_METADATA_ERROR_MESSAGES: Record<string, string> = {
  HTTP_ERROR: 'Le fichier de métadonnées a répondu avec une erreur HTTP.',
  TIMEOUT: 'Le fichier de métadonnées met trop de temps à répondre.',
  NETWORK_ERROR: 'Le fichier de métadonnées est injoignable.',
  INVALID_RESPONSE: 'Le fichier de métadonnées est invalide.',
  UNSUPPORTED_PROTOCOL:
    'Version de protocole des métadonnées non prise en charge.',
  ENVIRONMENT_MISMATCH:
    'Le fichier de métadonnées décrit un autre environnement que celui configuré.',
  GITHUB_RATE_LIMITED:
    'Limite de requêtes GitHub atteinte, réessayer plus tard.',
  GITHUB_AUTHENTICATION_FAILED:
    'GitHub a refusé le jeton configuré côté serveur.',
  GITHUB_FORBIDDEN: "GitHub refuse l'accès aux déploiements de ce dépôt.",
  GITHUB_REPOSITORY_UNAVAILABLE:
    'Dépôt GitHub privé ou inaccessible, vérifier GITHUB_TOKEN côté serveur.',
  GITHUB_REQUEST_FAILED: 'La requête vers GitHub a échoué.',
  GITHUB_INVALID_RESPONSE: 'GitHub a renvoyé une réponse inexploitable.',
};
