import { bulkQueue } from '@api/bulkQueue';
import { checkDeployments } from '@api/repositories.api';
import type { DeploymentCheck, MonitoringResponse } from '@api/types';
import { useKeyedAsyncAction } from '@hooks/useKeyedAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';
import { useCallback, useState } from 'react';

const KEY_SEPARATOR = '\u0000';
const targetKey = (path: string, environment: string) =>
  `${path}${KEY_SEPARATOR}${environment}`;
const splitTargetKey = (key: string): [path: string, environment: string] => {
  const [path, environment] = key.split(KEY_SEPARATOR);
  return [path, environment];
};

function mergeChecks(
  bulk: DeploymentCheck[],
  targeted: DeploymentCheck[],
): DeploymentCheck[] {
  const merged = new Map<string, DeploymentCheck>();
  for (const check of [...bulk, ...targeted]) {
    const known = merged.get(check.environment);
    if (!known || check.checkedAt >= known.checkedAt) {
      merged.set(check.environment, check);
    }
  }
  return [...merged.values()];
}

export function useDeploymentActions() {
  const { showToast } = useToast();
  const [targetedChecks, setTargetedChecks] = useState<
    Record<string, DeploymentCheck[]>
  >({});

  const bulk = useKeyedAsyncAction((path: string) => checkDeployments(path), {
    queue: bulkQueue,
    onError: (path, error) =>
      showToast(
        `Vérification impossible sur ${repositoryName(path)} : ${describeApiError(error)}`,
      ),
  });

  const targeted = useKeyedAsyncAction(
    (key: string) => {
      const [path, environment] = splitTargetKey(key);
      return checkDeployments(path, environment);
    },
    {
      onSuccess: (key, data) => {
        const [path] = splitTargetKey(key);
        setTargetedChecks((previous) => ({
          ...previous,
          [path]: mergeChecks(previous[path] ?? [], data.checks),
        }));
      },
      onError: (key, error) => {
        const [path, environment] = splitTargetKey(key);
        showToast(
          `Ping impossible sur ${environment} de ${repositoryName(path)} : ${describeApiError(error)}`,
        );
      },
    },
  );

  const runAll = async (paths: string[]) => {
    const { failed } = await bulk.runMany(paths);
    showToast(
      failed === 0
        ? 'Déploiements vérifiés'
        : `Vérification : ${failed} en erreur`,
    );
  };

  const monitoringOf = useCallback(
    (path: string): MonitoringResponse | null => {
      const whole = bulk.stateOf(path).data;
      const single = targetedChecks[path];
      if (!whole && !single) return null;
      return {
        path,
        configured: (whole?.configured ?? false) || single !== undefined,
        checks: mergeChecks(whole?.checks ?? [], single ?? []),
      };
    },
    [bulk.stateOf, targetedChecks],
  );

  return {
    stateOf: bulk.stateOf,
    monitoringOf,
    run: bulk.run,
    runAll,
    isBusy: bulk.isBusy || targeted.isBusy,
    pingStateOf: (path: string, environment: string) =>
      targeted.stateOf(targetKey(path, environment)),
    ping: (path: string, environment: string) =>
      targeted.run(targetKey(path, environment)),
  };
}
