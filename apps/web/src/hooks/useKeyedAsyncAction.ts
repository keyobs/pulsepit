import { useCallback, useEffect, useRef, useState } from 'react';
import { type AsyncState, IDLE_STATE } from './useAsyncAction';

interface Queue {
  enqueue: <R>(task: () => Promise<R>) => Promise<R>;
}

interface Options<T> {
  /** File qui limite les appels simultanés des actions de masse. */
  queue?: Queue;
  onSuccess?: (key: string, data: T) => void;
  onError?: (key: string, error: Error) => void;
}

export interface BulkResult {
  succeeded: number;
  failed: number;
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: Error };

/**
 * Comme useAsyncAction, mais un état par clé (un dépôt, par exemple), avec une action de masse
 * qui passe par une file pour limiter les appels simultanés.
 */
export function useKeyedAsyncAction<T>(
  action: (key: string) => Promise<T>,
  { queue, onSuccess, onError }: Options<T> = {},
) {
  const [states, setStates] = useState<Record<string, AsyncState<T>>>({});
  const latest = useRef({ action, onSuccess, onError });
  const lastRun = useRef<Record<string, number>>({});
  const mounted = useRef(true);

  useEffect(() => {
    latest.current = { action, onSuccess, onError };
  }, [action, onSuccess, onError]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const markLoading = useCallback((keys: string[]) => {
    setStates((previous) => {
      const next = { ...previous };
      for (const key of keys) {
        next[key] = {
          status: 'loading',
          data: previous[key]?.data ?? null,
          error: null,
        };
      }
      return next;
    });
  }, []);

  const execute = useCallback(
    async (key: string): Promise<Outcome<T>> => {
      const runId = (lastRun.current[key] ?? 0) + 1;
      lastRun.current[key] = runId;
      const isCurrent = () => mounted.current && lastRun.current[key] === runId;
      markLoading([key]);
      try {
        const data = await latest.current.action(key);
        if (isCurrent()) {
          setStates((previous) => ({
            ...previous,
            [key]: { status: 'success', data, error: null },
          }));
        }
        return { ok: true, data };
      } catch (caught) {
        const error =
          caught instanceof Error ? caught : new Error(String(caught));
        if (isCurrent()) {
          setStates((previous) => ({
            ...previous,
            [key]: {
              status: 'error',
              data: previous[key]?.data ?? null,
              error,
            },
          }));
        }
        return { ok: false, error };
      }
    },
    [markLoading],
  );

  const run = useCallback(
    async (key: string): Promise<T | undefined> => {
      const outcome = await execute(key);
      if (outcome.ok) {
        latest.current.onSuccess?.(key, outcome.data);
        return outcome.data;
      }
      latest.current.onError?.(key, outcome.error);
      return undefined;
    },
    [execute],
  );

  const runMany = useCallback(
    async (keys: string[]): Promise<BulkResult> => {
      markLoading(keys);
      const outcomes = await Promise.all(
        keys.map((key) =>
          queue ? queue.enqueue(() => execute(key)) : execute(key),
        ),
      );
      const succeeded = outcomes.filter((outcome) => outcome.ok).length;
      return { succeeded, failed: outcomes.length - succeeded };
    },
    [execute, markLoading, queue],
  );

  const stateOf = useCallback(
    (key: string): AsyncState<T> => states[key] ?? IDLE_STATE,
    [states],
  );
  const isBusy = Object.values(states).some(
    (state) => state.status === 'loading',
  );

  return { stateOf, run, runMany, isBusy };
}
