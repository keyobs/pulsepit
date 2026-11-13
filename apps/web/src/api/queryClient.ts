import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

const DAY_MS = 24 * 60 * 60 * 1000;

export const OUTDATED_QUERY = 'outdated';
export const PACKAGE_QUERY = 'package';
export const GIT_TREE_QUERY = 'git-tree';

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: DAY_MS,
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

/** Seuls les diagnostics réussis survivent au rechargement de la page. */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({
    storage,
    key: 'pulsepit-query-cache',
  }),
  maxAge: DAY_MS,
  // Bump when the OutdatedResponse contract changes.
  buster: 'outdated-v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.queryKey[0] === OUTDATED_QUERY && query.state.status === 'success',
  },
};
