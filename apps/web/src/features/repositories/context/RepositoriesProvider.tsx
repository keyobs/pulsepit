import { useRepositories } from '@hooks/useRepositories';
import { useRescanWatcher } from '@hooks/useRescanWatcher';
import { type ReactNode, useMemo } from 'react';
import { useDeploymentActions } from '../hooks/useDeploymentActions';
import { useExpandedRepositories } from '../hooks/useExpandedRepositories';
import { useFetchActions } from '../hooks/useFetchActions';
import { useInstallActions } from '../hooks/useInstallActions';
import { useOutdatedActions } from '../hooks/useOutdatedActions';
import { useRepositoryFilters } from '../hooks/useRepositoryFilters';
import { RepositoriesContext } from './repositoriesContext';

interface RepositoriesProviderProps {
  children: ReactNode;
}

export const RepositoriesProvider = ({
  children,
}: RepositoriesProviderProps) => {
  const list = useRepositories();
  useRescanWatcher(list.reload);
  const fetching = useFetchActions(list.reload);
  const diagnostics = useOutdatedActions();
  const installs = useInstallActions();
  const deployments = useDeploymentActions();
  const view = useExpandedRepositories();
  const filters = useRepositoryFilters(
    list.repositories,
    deployments.monitoringOf,
    (path) => diagnostics.stateOf(path).data,
  );

  const value = useMemo(
    () => ({
      list,
      filters,
      view,
      fetching,
      diagnostics,
      installs,
      deployments,
    }),
    [list, filters, view, fetching, diagnostics, installs, deployments],
  );

  return (
    <RepositoriesContext.Provider value={value}>
      {children}
    </RepositoriesContext.Provider>
  );
};
