import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: Error | null;
}

export const IDLE_STATE: AsyncState<never> = {
  status: 'idle',
  data: null,
  error: null,
};

/**
 * Suit l'état d'une action asynchrone (inactif, en cours, succès, erreur).
 * Les données précédentes sont conservées pendant un nouvel appel, et seul le dernier appel compte.
 */
export function useAsyncAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
) {
  const [state, setState] = useState<AsyncState<T>>(IDLE_STATE);
  const actionRef = useRef(action);
  const lastRun = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args: Args): Promise<T | undefined> => {
    const runId = ++lastRun.current;
    const isCurrent = () => mounted.current && runId === lastRun.current;
    setState((previous) => ({
      status: 'loading',
      data: previous.data,
      error: null,
    }));
    try {
      const data = await actionRef.current(...args);
      if (isCurrent()) setState({ status: 'success', data, error: null });
      return data;
    } catch (caught) {
      const error =
        caught instanceof Error ? caught : new Error(String(caught));
      if (isCurrent()) {
        setState((previous) => ({
          status: 'error',
          data: previous.data,
          error,
        }));
      }
      return undefined;
    }
  }, []);

  const reset = useCallback(() => {
    lastRun.current += 1;
    setState(IDLE_STATE);
  }, []);

  return { ...state, isLoading: state.status === 'loading', run, reset };
}
