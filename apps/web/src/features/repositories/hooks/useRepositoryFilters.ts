import type {
  MonitoringResponse,
  OutdatedResponse,
  Repository,
} from '@api/types';
import type { RepositoryFilter } from '@constants/repositoryFilters';
import { hasOutdated, isDirty, isOffline } from '@utils/repositoryStatus';
import { useMemo, useState } from 'react';

/** Recherche par nom ou chemin et filtre d'état. */
export function useRepositoryFilters(
  repositories: Repository[],
  getMonitoring: (path: string) => MonitoringResponse | null,
  getOutdated: (path: string) => OutdatedResponse | null,
) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RepositoryFilter>('all');

  const visibleRepositories = useMemo(() => {
    const text = query.trim().toLowerCase();
    return repositories.filter((repository) => {
      if (
        text &&
        !`${repository.name} ${repository.path}`.toLowerCase().includes(text)
      ) {
        return false;
      }
      switch (filter) {
        case 'dirty':
          return isDirty(repository);
        case 'offline':
          return isOffline(getMonitoring(repository.path));
        case 'outdated':
          return hasOutdated(getOutdated(repository.path));
        default:
          return true;
      }
    });
  }, [repositories, query, filter, getMonitoring, getOutdated]);

  return { query, setQuery, filter, setFilter, visibleRepositories };
}
