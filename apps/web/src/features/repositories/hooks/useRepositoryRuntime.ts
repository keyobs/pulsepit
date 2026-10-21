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
      run: () => deployments.run(path),
    },
    isExpanded: view.isExpanded(path),
    toggleExpanded: () => view.toggle(path),
  };
}
