import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { PushIcon } from '@components/icons/PushIcon';
import { usePushAction } from '../../hooks/usePushAction';
import { PushBranchMenu } from './PushBranchMenu';
import './pushGroup.less';

interface PushGroupProps {
  repository: Repository;
}

export const PushGroup = ({ repository }: PushGroupProps) => {
  const { push, isPushing } = usePushAction(repository.path);
  return (
    <div className="pp-push-group">
      <Button
        icon={<PushIcon />}
        loading={isPushing}
        onClick={() => void push('main')}
      >
        Push main
      </Button>
      <Button
        icon={<PushIcon />}
        loading={isPushing}
        onClick={() => void push('develop')}
      >
        Push develop
      </Button>
      <PushBranchMenu
        path={repository.path}
        disabled={isPushing}
        onPush={push}
      />
    </div>
  );
};
