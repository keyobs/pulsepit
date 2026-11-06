import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { PushIcon } from '@components/icons/PushIcon';
import { useBranches } from '@hooks/useBranches';
import { useEffect } from 'react';
import { TbShieldCheck } from 'react-icons/tb';
import { useChecksRun } from '../../hooks/useChecksRun';
import { usePushAction } from '../../hooks/usePushAction';
import { usePushLock } from '../../hooks/usePushLock';
import { ChecksStatus } from './ChecksStatus';
import { PushBranchMenu } from './PushBranchMenu';
import { PushLockButton } from './PushLockButton';
import { getPushAvailability } from './pushAvailability';
import './pushGroup.less';

const MAIN_BRANCHES = ['main', 'develop'];

interface PushGroupProps {
  repository: Repository;
}

export const PushGroup = ({ repository }: PushGroupProps) => {
  const { push, isPushing } = usePushAction(repository.path);
  const { data, run } = useBranches(repository.path);
  const checks = useChecksRun(repository.path, () => void run());
  const locks = usePushLock(repository.path, () => void run());

  useEffect(() => {
    void run();
  }, [run]);

  const branches = data?.branches ?? [];
  const current = branches.find((branch) => branch.isCurrent);
  const pushBranch = (name: string) =>
    push(name, branches.find((b) => b.name === name)?.checksId ?? undefined);
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
        {MAIN_BRANCHES.map((name) => {
          const branch = branches.find((b) => b.name === name);
          if (name === 'develop' && !branch) return null;
          const availability = getPushAvailability(branch);
          return (
            <span key={name} className="pp-push-pair">
              <PushLockButton
                branch={name}
                scope={locks.scopeOf(name)}
                loading={locks.savingBranch === name}
                onToggle={() => void locks.toggle(name)}
              />
              <Button
                icon={<PushIcon />}
                loading={isPushing}
                disabled={!availability.canAttempt}
                title={availability.reason ?? undefined}
                onClick={() => void pushBranch(name)}
              >
                Push {name}
              </Button>
            </span>
          );
        })}
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
