import type { LocalBranch } from '@api/types';
import { DropdownMenu } from '@components/dropdownMenu/DropdownMenu';
import { PushIcon } from '@components/icons/PushIcon';
import { getPushAvailability } from './pushAvailability';

interface PushBranchMenuProps {
  branches: LocalBranch[];
  disabled?: boolean;
  onPush: (branch: string) => void;
}

/** Menu pour pousser une branche locale autre que main et develop, qui ont déjà leur bouton. */
export const PushBranchMenu = ({
  branches,
  disabled,
  onPush,
}: PushBranchMenuProps) => {
  const items = branches
    .filter((branch) => branch.name !== 'main' && branch.name !== 'develop')
    .map((branch) => {
      const { canAttempt, reason } = getPushAvailability(branch);
      return {
        id: branch.name,
        label: branch.name,
        hint: reason ?? '→ origin',
        disabled: !canAttempt,
      };
    });

  return (
    <DropdownMenu
      label="Push - Choisir une branche"
      icon={<PushIcon />}
      header="Branche locale à pousser vers origin"
      emptyText="Aucune autre branche locale"
      items={items}
      disabled={disabled}
      onSelect={onPush}
    />
  );
};
