import type {
  MonitoringResponse,
  OutdatedResponse,
  Repository,
} from '@api/types';
import {
  hasOutdated,
  isDevelopAhead,
  isDirty,
  isOffline,
} from './repositoryStatus';

export interface RepositorySummary {
  total: number;
  dirty: number;
  developAhead: number;
  /** `null` tant qu'aucune vérification de déploiement n'a eu lieu. */
  offline: number | null;
  /** `null` tant qu'aucun diagnostic n'a été lancé. */
  outdated: number | null;
}

export function summarizeRepositories(
  repositories: Repository[],
  getMonitoring: (path: string) => MonitoringResponse | null,
  getOutdated: (path: string) => OutdatedResponse | null,
): RepositorySummary {
  const monitored = repositories.filter((repository) =>
    getMonitoring(repository.path),
  );
  const diagnosed = repositories.filter((repository) =>
    getOutdated(repository.path),
  );
  return {
    total: repositories.length,
    dirty: repositories.filter(isDirty).length,
    developAhead: repositories.filter(isDevelopAhead).length,
    offline:
      monitored.length === 0
        ? null
        : monitored.filter((repository) =>
            isOffline(getMonitoring(repository.path)),
          ).length,
    outdated:
      diagnosed.length === 0
        ? null
        : diagnosed.filter((repository) =>
            hasOutdated(getOutdated(repository.path)),
          ).length,
  };
}
