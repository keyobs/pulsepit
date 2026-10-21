import type { Repository } from '@api/types';
import { BeaconIndicator } from '../beacon/BeaconIndicator';
import './repositoryIdentity.less';

interface RepositoryIdentityProps {
  repository: Repository;
  expanded: boolean;
  onToggle: () => void;
}

/** Nom et chemin du dépôt : un clic ouvre ou ferme le panneau de détails. */
export const RepositoryIdentity = ({
  repository,
  expanded,
  onToggle,
}: RepositoryIdentityProps) => (
  <button
    type="button"
    className="pp-repository-identity"
    aria-expanded={expanded}
    onClick={onToggle}
  >
    <span className="pp-repository-identity-name">
      {repository.name}
      <BeaconIndicator beacon={repository.beacon} />
    </span>
    <span className="pp-repository-identity-path" title={repository.path}>
      {repository.path}
    </span>
  </button>
);
