import type {
  MonitoringResponse,
  OutdatedResponse,
  Repository,
} from '@api/types';

export const isDirty = (repository: Repository): boolean =>
  repository.git !== null && !repository.git.isClean;

/** `develop` porte une version différente de `main` : des changements attendent d'être publiés. */
export const isDevelopAhead = (repository: Repository): boolean => {
  const { main, develop } = repository.versions;
  return (
    main.version !== null &&
    develop.version !== null &&
    main.version !== develop.version
  );
};

export const environmentsOf = (repository: Repository): string[] =>
  Object.keys(repository.urls);

export const isOffline = (monitoring: MonitoringResponse | null): boolean =>
  monitoring?.checks.some((check) => check.status === 'offline') ?? false;

export const hasOutdated = (outdated: OutdatedResponse | null): boolean =>
  (outdated?.dependencies.length ?? 0) > 0;
