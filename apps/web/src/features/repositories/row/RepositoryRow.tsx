import type { Repository } from '@api/types';
import { cleanClasses } from '@utils/cleanClasses';
import { useRepositoryRuntime } from '../hooks/useRepositoryRuntime';
import { RepositoryPanel } from '../panel/RepositoryPanel';
import { DeploymentCell } from './DeploymentCell';
import { GitCell } from './GitCell';
import { RepositoryIdentity } from './RepositoryIdentity';
import { RowActions } from './RowActions';
import { VersionsCell } from './VersionsCell';
import './repositoryRow.less';

interface RepositoryRowProps {
  repository: Repository;
}

export const RepositoryRow = ({ repository }: RepositoryRowProps) => {
  const { isExpanded, toggleExpanded } = useRepositoryRuntime(repository.path);
  return (
    <article
      className={cleanClasses('pp-repository-row', isExpanded && 'open')}
    >
      <div className="pp-repository-row-main">
        <RepositoryIdentity
          repository={repository}
          expanded={isExpanded}
          onToggle={toggleExpanded}
        />
        <GitCell repository={repository} />
        <VersionsCell repository={repository} />
        <DeploymentCell repository={repository} />
        <RowActions
          path={repository.path}
          expanded={isExpanded}
          onToggle={toggleExpanded}
        />
      </div>
      {isExpanded && <RepositoryPanel repository={repository} />}
    </article>
  );
};
