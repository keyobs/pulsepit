import type { useRepositories } from '@hooks/useRepositories';
import { createContext } from 'react';
import type { useDeploymentActions } from '../hooks/useDeploymentActions';
import type { useExpandedRepositories } from '../hooks/useExpandedRepositories';
import type { useFetchActions } from '../hooks/useFetchActions';
import type { useOutdatedActions } from '../hooks/useOutdatedActions';
import type { useRepositoryFilters } from '../hooks/useRepositoryFilters';

export interface RepositoriesContextValue {
  list: ReturnType<typeof useRepositories>;
  filters: ReturnType<typeof useRepositoryFilters>;
  view: ReturnType<typeof useExpandedRepositories>;
  fetching: ReturnType<typeof useFetchActions>;
  diagnostics: ReturnType<typeof useOutdatedActions>;
  deployments: ReturnType<typeof useDeploymentActions>;
}

export const RepositoriesContext =
  createContext<RepositoriesContextValue | null>(null);
