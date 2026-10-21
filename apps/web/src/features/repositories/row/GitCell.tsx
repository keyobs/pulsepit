import type { Repository } from '@api/types';
import { Chip } from '@components/chip/Chip';
import { LabeledCell } from '@components/labeledCell/LabeledCell';
import { Stack } from '@components/stack/Stack';
import { TbGitBranch } from 'react-icons/tb';
import { SyncChip } from './SyncChip';

interface GitCellProps {
  repository: Repository;
}

export const GitCell = ({ repository }: GitCellProps) => {
  const { git, gitError, sync } = repository;
  return (
    <LabeledCell label="Git">
      <Stack>
        {git === null ? (
          <Chip variant="bad" title={gitError ?? undefined}>
            erreur git
          </Chip>
        ) : (
          <>
            <Chip variant="accent" icon={<TbGitBranch aria-hidden="true" />}>
              {git.branch ?? 'detached'}
            </Chip>
            {git.isClean ? (
              <Chip variant="ok">propre</Chip>
            ) : (
              <>
                {git.changedFiles > 0 && (
                  <Chip variant="warn">
                    {git.changedFiles} modifié{git.changedFiles > 1 ? 's' : ''}
                  </Chip>
                )}
                {git.untrackedFiles > 0 && (
                  <Chip variant="warn">
                    {git.untrackedFiles} non suivi
                    {git.untrackedFiles > 1 ? 's' : ''}
                  </Chip>
                )}
              </>
            )}
            {sync && <SyncChip sync={sync} />}
          </>
        )}
      </Stack>
    </LabeledCell>
  );
};
