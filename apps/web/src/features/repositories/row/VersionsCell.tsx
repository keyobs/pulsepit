import type { Repository } from '@api/types';
import { Chip } from '@components/chip/Chip';
import { LabeledCell } from '@components/labeledCell/LabeledCell';
import { isDevelopAhead } from '@utils/repositoryStatus';
import { VersionLine } from './VersionLine';
import './versionsCell.less';

interface VersionsCellProps {
  repository: Repository;
}

const versionLabel = (name: string, version: string | null) =>
  `${name} ${version ?? '—'}`;

export const VersionsCell = ({ repository }: VersionsCellProps) => {
  const { main, develop } = repository.versions;
  return (
    <LabeledCell label="Versions">
      <div className="pp-versions-cell">
        <VersionLine
          chip={
            <Chip
              variant={isDevelopAhead(repository) ? 'warn' : 'neutral'}
              title={main.error ?? undefined}
            >
              {versionLabel('main', main.version)}
            </Chip>
          }
        />
        <VersionLine
          chip={
            <Chip title={develop.error ?? undefined}>
              {versionLabel('develop', develop.version)}
            </Chip>
          }
          iso={repository.developLastCommitAt}
          caption="dernier commit distant"
        />
      </div>
    </LabeledCell>
  );
};
