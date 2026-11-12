import { bulkQueue } from '@api/bulkQueue';
import { OUTDATED_QUERY, PACKAGE_QUERY } from '@api/queryClient';
import { getOutdated } from '@api/repositories.api';
import type { OutdatedResponse } from '@api/types';
import type { AsyncState } from '@hooks/useAsyncAction';
import { useToast } from '@hooks/useToast';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';
import { useCallback, useMemo, useState } from 'react';

export interface OutdatedState extends AsyncState<OutdatedResponse> {
  updatedAt: number | null;
}

const IDLE: OutdatedState = {
  status: 'idle',
  data: null,
  error: null,
  updatedAt: null,
};

const queryKey = (path: string) => [OUTDATED_QUERY, path];

/** Diagnostic des dépendances, mis en cache (et persisté) par TanStack Query. */
export function useOutdatedActions(paths: string[]) {
  const { showToast } = useToast();
  const client = useQueryClient();
  const [queued, setQueued] = useState<ReadonlySet<string>>(new Set());

  const results = useQueries({
    queries: paths.map((path) => ({
      queryKey: queryKey(path),
      queryFn: () => getOutdated(path),
      enabled: false,
    })),
  });

  const states = useMemo(() => {
    const map = new Map<string, OutdatedState>();
    paths.forEach((path, index) => {
      const query = results[index];
      if (!query) return;
      const data = query.data ?? null;
      map.set(path, {
        status:
          query.isFetching || queued.has(path)
            ? 'loading'
            : query.isError
              ? 'error'
              : data
                ? 'success'
                : 'idle',
        data,
        error: query.isFetching ? null : query.error,
        updatedAt: query.dataUpdatedAt || null,
      });
    });
    return map;
  }, [paths, results, queued]);

  const fetchOne = useCallback(
    async (path: string) => {
      const result = await client.fetchQuery({
        queryKey: queryKey(path),
        queryFn: () => getOutdated(path),
        staleTime: 0,
      });
      void client.invalidateQueries({ queryKey: [PACKAGE_QUERY, path] });
      return result;
    },
    [client],
  );

  const run = useCallback(
    async (path: string) => {
      try {
        const result = await fetchOne(path);
        showToast(
          `Diagnostic terminé : ${repositoryName(path)} (${result.dependencies.length} à mettre à jour)`,
        );
        return result;
      } catch (error) {
        showToast(
          `Diagnostic impossible sur ${repositoryName(path)} : ${describeApiError(error as Error)}`,
        );
        return undefined;
      }
    },
    [fetchOne, showToast],
  );

  const runAll = useCallback(
    async (targets: string[]) => {
      setQueued(new Set(targets));
      const unqueue = (path: string) =>
        setQueued((previous) => {
          const next = new Set(previous);
          next.delete(path);
          return next;
        });
      const outcomes = await Promise.all(
        targets.map((path) =>
          bulkQueue.enqueue(async () => {
            const fetching = fetchOne(path);
            unqueue(path);
            return fetching.then(
              () => true,
              () => false,
            );
          }),
        ),
      );
      const succeeded = outcomes.filter(Boolean).length;
      const failed = outcomes.length - succeeded;
      showToast(
        failed === 0
          ? `Diagnostic terminé sur ${succeeded} dépôt${succeeded > 1 ? 's' : ''}`
          : `Diagnostic : ${succeeded} réussi${succeeded > 1 ? 's' : ''}, ${failed} en erreur`,
      );
    },
    [fetchOne, showToast],
  );

  const stateOf = useCallback(
    (path: string) => states.get(path) ?? IDLE,
    [states],
  );
  const isBusy = [...states.values()].some(
    (state) => state.status === 'loading',
  );

  return { stateOf, run, runAll, isBusy };
}
