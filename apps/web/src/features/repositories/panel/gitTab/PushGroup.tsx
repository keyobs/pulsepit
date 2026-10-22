import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { PushIcon } from '@components/icons/PushIcon';
import { useBranches } from '@hooks/useBranches';
import { useEffect } from 'react';
import { usePushAction } from '../../hooks/usePushAction';
import { PushBranchMenu } from './PushBranchMenu';
import { getPushAvailability } from './pushAvailability';
import './pushGroup.less';

interface PushGroupProps {
  repository: Repository;
}

export const PushGroup = ({ repository }: PushGroupProps) => {
  const { push, isPushing } = usePushAction(repository.path);
  const { data, run } = useBranches(repository.path);

  useEffect(() => {
    void run();
  }, [run]);

  const branches = data?.branches ?? [];
  const main = getPushAvailability(branches.find((b) => b.name === 'main'));
  const develop = getPushAvailability(
    branches.find((b) => b.name === 'develop'),
  );
  return (
    <div className="pp-push-group">
      <Button
        icon={<PushIcon />}
        loading={isPushing}
        disabled={!main.canAttempt}
        title={main.reason ?? undefined}
        onClick={() => void push('main')}
      >
        Push main
      </Button>
      <Button
        icon={<PushIcon />}
        loading={isPushing}
        disabled={!develop.canAttempt}
        title={develop.reason ?? undefined}
        onClick={() => void push('develop')}
      >
        Push develop
      </Button>
      <PushBranchMenu branches={branches} disabled={isPushing} onPush={push} />
    </div>
  );
};
