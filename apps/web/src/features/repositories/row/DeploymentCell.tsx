import type { Repository } from '@api/types';
import { Chip } from '@components/chip/Chip';
import { LabeledCell } from '@components/labeledCell/LabeledCell';
import { Stack } from '@components/stack/Stack';
import { StatusDot } from '@components/statusDot/StatusDot';
import { environmentsOf } from '@utils/repositoryStatus';
import { useRepositoryRuntime } from '../hooks/useRepositoryRuntime';

interface DeploymentCellProps {
  repository: Repository;
}

export const DeploymentCell = ({ repository }: DeploymentCellProps) => {
  const { deployments } = useRepositoryRuntime(repository.path);
  const environments = environmentsOf(repository);
  const checks = deployments.state.data?.checks ?? [];

  return (
    <LabeledCell label="Déploiement">
      {environments.length === 0 ? (
        <span className="pp-muted-text">Non configuré</span>
      ) : (
        <Stack>
          {environments.map((environment) => {
            const status = checks.find(
              (check) => check.environment === environment,
            )?.status;
            return (
              <Chip
                key={environment}
                icon={
                  <StatusDot
                    status={
                      status === 'online'
                        ? 'ok'
                        : status === 'offline'
                          ? 'bad'
                          : 'off'
                    }
                  />
                }
              >
                {environment}
              </Chip>
            );
          })}
        </Stack>
      )}
    </LabeledCell>
  );
};
