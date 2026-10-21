import type { Repository } from '@api/types';
import { EmptyState } from '@components/emptyState/EmptyState';
import { environmentsOf } from '@utils/repositoryStatus';
import { EnvironmentCard } from './EnvironmentCard';
import { WorkflowsSection } from './WorkflowsSection';
import './deploymentTab.less';

interface DeploymentTabProps {
  repository: Repository;
}

export const DeploymentTab = ({ repository }: DeploymentTabProps) => {
  const environments = environmentsOf(repository);
  return (
    <div className="pp-deployment-tab">
      {environments.length === 0 ? (
        <EmptyState>
          Aucune URL de staging ou de production configurée pour ce dépôt.
        </EmptyState>
      ) : (
        <div className="pp-deployment-tab-environments">
          {environments.map((environment) => (
            <EnvironmentCard
              key={environment}
              repository={repository}
              environment={environment}
            />
          ))}
        </div>
      )}
      <WorkflowsSection path={repository.path} />
    </div>
  );
};
