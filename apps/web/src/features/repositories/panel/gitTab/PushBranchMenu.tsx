import { DropdownMenu } from '@components/dropdownMenu/DropdownMenu';
import { PushIcon } from '@components/icons/PushIcon';
import { useBranches } from '@hooks/useBranches';
import { useEffect } from 'react';

interface PushBranchMenuProps {
  path: string;
  disabled?: boolean;
  onPush: (branch: string) => void;
}

/** Menu pour pousser une branche locale autre que main et develop, qui ont déjà leur bouton. */
export const PushBranchMenu = ({
  path,
  disabled,
  onPush,
}: PushBranchMenuProps) => {
  const { data, run } = useBranches(path);

  useEffect(() => {
    void run();
  }, [run]);

  const items = (data?.branches ?? [])
    .filter((branch) => branch.name !== 'main' && branch.name !== 'develop')
    .map((branch) => ({
      id: branch.name,
      label: branch.name,
      hint: '→ origin',
    }));

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
