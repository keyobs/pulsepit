import { IconButton } from '@components/iconButton/IconButton';
import { TbLock, TbLockOpen } from 'react-icons/tb';
import type { PushLockScope } from '../../../settings/pushLockSettings';

interface PushLockButtonProps {
  branch: string;
  scope: PushLockScope | null;
  loading: boolean;
  onToggle: () => void;
}

const labelOf = (branch: string, scope: PushLockScope | null) => {
  if (scope === 'other')
    return `Push de ${branch} verrouillé par un réglage plus large (voir Réglages)`;
  if (scope === 'branch') return `Déverrouiller le push de ${branch}`;
  return `Verrouiller le push de ${branch}`;
};

export const PushLockButton = ({
  branch,
  scope,
  loading,
  onToggle,
}: PushLockButtonProps) => (
  <IconButton
    className="pp-push-lock"
    icon={scope === 'none' || scope === null ? <TbLockOpen /> : <TbLock />}
    label={labelOf(branch, scope)}
    aria-pressed={scope !== 'none' && scope !== null}
    loading={loading}
    disabled={scope === null || scope === 'other'}
    onClick={onToggle}
  />
);
