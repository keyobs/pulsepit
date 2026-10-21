import { useRepositoriesContext } from '../context/useRepositoriesContext';

/** État et actions d'un dépôt : fetch, diagnostic des dépendances, vérification des déploiements, panneau. */
export function useRepositoryRuntime(path: string) {
  const { fetching, diagnostics, deployments, view } = useRepositoriesContext();
  return {
    fetch: { state: fetching.stateOf(path), run: () => fetching.run(path) },
    outdated: {
      state: diagnostics.stateOf(path),
      run: () => diagnostics.run(path),
    },
    deployments: {
      state: deployments.stateOf(path),
      monitoring: deployments.monitoringOf(path),
      run: () => deployments.run(path),
      pingStateOf: (environment: string) =>
        deployments.pingStateOf(path, environment),
      ping: (environment: string) => deployments.ping(path, environment),
    },
    isExpanded: view.isExpanded(path),
    toggleExpanded: () => view.toggle(path),
  };
}
