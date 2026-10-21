import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { EmptyState } from '@components/emptyState/EmptyState';
import { useDeployments } from '@hooks/useDeployments';
import { describeApiError } from '@utils/describeApiError';
import { environmentsOf } from '@utils/repositoryStatus';
import { useEffect } from 'react';
import { EnvironmentCard } from './EnvironmentCard';
import { WorkflowsSection } from './WorkflowsSection';
import './deploymentTab.less';

interface DeploymentTabProps {
  repository: Repository;
}

export const DeploymentTab = ({ repository }: DeploymentTabProps) => {
  const environments = environmentsOf(repository);
  const metadata = useDeployments(repository.path);
  const { run } = metadata;

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="pp-deployment-tab">
      {environments.length === 0 ? (
        <EmptyState>
          Aucun environnement de déploiement configuré pour ce dépôt.
        </EmptyState>
      ) : (
        <>
          <div className="pp-deployment-tab-toolbar">
            {metadata.error && (
              <span className="pp-deployment-tab-error" role="alert">
                Métadonnées indisponibles : {describeApiError(metadata.error)}
              </span>
            )}
            <Button
              size="small"
              loading={metadata.isLoading}
              onClick={() => void run()}
            >
              Actualiser
            </Button>
          </div>
          <div className="pp-deployment-tab-environments">
            {environments.map((config) => (
              <EnvironmentCard
                key={config.environment}
                repository={repository}
                config={config}
                metadata={
                  metadata.data?.environments.find(
                    (item) => item.environment === config.environment,
                  ) ?? null
                }
              />
            ))}
          </div>
        </>
      )}
      <WorkflowsSection path={repository.path} />
    </div>
  );
};
