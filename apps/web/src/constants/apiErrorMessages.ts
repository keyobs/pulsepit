/** Message affiché pour chaque code d'erreur connu. Les autres codes affichent le message du serveur. */
export const API_ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "Impossible de joindre l'API locale. Est-elle démarrée ?",
  CLIENT_TIMEOUT: 'Le serveur met trop de temps à répondre.',
  INVALID_RESPONSE: "La réponse de l'API ne respecte pas le contrat.",
  TIMEOUT: "L'opération a dépassé son délai.",
  FETCH_FAILED: 'Le fetch a échoué : remote injoignable ou refusé.',
  INVALID_BRANCH: 'Nom de branche invalide.',
  BRANCH_NOT_FOUND: "Cette branche n'existe pas en local.",
  REMOTE_NOT_FOUND: "Aucun remote « origin » n'est configuré.",
  NON_FAST_FORWARD:
    'La branche distante est en avance : faire un pull avant de pousser.',
  REMOTE_REJECTED: 'Le remote a refusé le push.',
  AUTHENTICATION_FAILED: 'Authentification refusée par le remote.',
  DIRECT_PUSH_FORBIDDEN: 'Push direct interdit sur cette branche.',
  INVALID_PUSH_POLICY: 'Politique de push invalide : push bloqué.',
  CHECK_RUNNER_UNAVAILABLE:
    'Des contrôles sont requis mais le serveur ne peut pas les exécuter.',
  GIT_STATE_UNAVAILABLE: "L'état Git est illisible : push impossible.",
  CHECKS_BUSY: 'Des contrôles ou un push sont déjà en cours sur ce dépôt.',
  CHECKS_CAPACITY: 'Trop de contrôles en cours : réessayer plus tard.',
  CHECKS_NOT_FOUND: 'Ces contrôles sont introuvables ou expirés.',
  CHECKS_INTERRUPTED:
    "Suivi interrompu par un redémarrage de l'API : relancer les contrôles.",
  CHECKS_FAILED: 'Les contrôles requis ont échoué.',
  CHECKS_TIMEOUT: 'Les contrôles ont dépassé leur délai.',
  CHECKS_CANCELLED: 'Les contrôles ont été annulés.',
  PUSH_INTERRUPTED:
    "Suivi du push interrompu : vérifier l'état du remote avant de réessayer.",
  CHECK_CONTEXT_MISMATCH:
    'Le contexte local a changé ou les contrôles ont expiré : relancer les contrôles.',
  PUSH_FAILED: 'Le push a échoué.',
  BRANCHES_FAILED: 'Impossible de lister les branches locales.',
  PACKAGE_MANAGER:
    'Gestionnaire de packages non détecté ou non pris en charge.',
  COMMAND_FAILED: 'La commande de diagnostic a échoué.',
  INVALID_OUTPUT: 'Le diagnostic a renvoyé un résultat inexploitable.',
};
