import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { PushIcon } from '@components/icons/PushIcon';
import { useBranches } from '@hooks/useBranches';
import { useEffect } from 'react';
import { TbShieldCheck } from 'react-icons/tb';
import { useChecksRun } from '../../hooks/useChecksRun';
import { usePushAction } from '../../hooks/usePushAction';
import { ChecksStatus } from './ChecksStatus';
import { PushBranchMenu } from './PushBranchMenu';
import { getPushAvailability } from './pushAvailability';
import './pushGroup.less';

interface PushGroupProps {
  repository: Repository;
}

export const PushGroup = ({ repository }: PushGroupProps) => {
  const { push, isPushing } = usePushAction(repository.path);
  const { data, run } = useBranches(repository.path);
  const checks = useChecksRun(repository.path, () => void run());

  useEffect(() => {
    void run();
  }, [run]);

  const branches = data?.branches ?? [];
  const current = branches.find((branch) => branch.isCurrent);
  const pushBranch = (name: string) =>
    push(name, branches.find((b) => b.name === name)?.checksId ?? undefined);
  const main = getPushAvailability(branches.find((b) => b.name === 'main'));
  const develop = getPushAvailability(
    branches.find((b) => b.name === 'develop'),
  );
  return (
    <>
      <div className="pp-push-group">
        <Button
          icon={<TbShieldCheck />}
          loading={checks.isStarting || checks.isRunning}
          disabled={!current}
          title={current ? undefined : 'Aucune branche courante'}
          onClick={() => current && void checks.start(current.name)}
        >
          Run checks
        </Button>
        {checks.isRunning && (
          <Button size="small" onClick={() => void checks.cancel()}>
            Annuler
          </Button>
        )}
        <Button
          icon={<PushIcon />}
          loading={isPushing}
          disabled={!main.canAttempt}
          title={main.reason ?? undefined}
          onClick={() => void pushBranch('main')}
        >
          Push main
        </Button>
        <Button
          icon={<PushIcon />}
          loading={isPushing}
          disabled={!develop.canAttempt}
          title={develop.reason ?? undefined}
          onClick={() => void pushBranch('develop')}
        >
          Push develop
        </Button>
        <PushBranchMenu
          branches={branches}
          disabled={isPushing}
          onPush={pushBranch}
        />
      </div>
      {checks.operation && (
        <div className="pp-git-bar-checks">
          <ChecksStatus operation={checks.operation} />
        </div>
      )}
    </>
  );
};
