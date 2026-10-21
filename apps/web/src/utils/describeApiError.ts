import { ApiError } from '@api/apiError';
import { API_ERROR_MESSAGES } from '@constants/apiErrorMessages';

/** Texte à montrer à l'utilisateur pour une erreur d'appel à l'API. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return API_ERROR_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Erreur inconnue.';
}
