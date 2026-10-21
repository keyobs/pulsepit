/** Erreur d'un appel à l'API : réponse HTTP d'erreur, réseau, délai dépassé ou réponse hors contrat. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly resetAt?: string;

  constructor(
    message: string,
    options: { status: number; code: string; resetAt?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.resetAt = options.resetAt;
  }
}

/** Codes produits par le client lui-même (le back n'en envoie aucun). */
export const CLIENT_ERROR_CODES = {
  network: 'NETWORK_ERROR',
  timeout: 'CLIENT_TIMEOUT',
  invalidResponse: 'INVALID_RESPONSE',
} as const;
