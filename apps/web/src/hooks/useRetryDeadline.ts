import { ApiError } from '@api/apiError';
import { useEffect, useReducer } from 'react';

const RATE_LIMITED = 'REGISTRY_RATE_LIMITED';

/** Échéance `resetAt` encore future d'une limitation de débit, sinon null ; se réévalue à l'échéance. */
export function useRetryDeadline(error: unknown): string | null {
  const resetAt =
    error instanceof ApiError && error.code === RATE_LIMITED
      ? (error.resetAt ?? null)
      : null;
  const [, refresh] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (resetAt === null) return;
    const delay = new Date(resetAt).getTime() - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [resetAt]);

  return resetAt !== null && new Date(resetAt).getTime() > Date.now()
    ? resetAt
    : null;
}
