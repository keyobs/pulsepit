import type { Repository } from '@api/types';
import { Card } from '@components/card/Card';
import { KeyValueList } from '@components/keyValueList/KeyValueList';
import { formatDateTime } from '@utils/formatDate';
import { GitBar } from './GitBar';
import './gitTab.less';

interface GitTabProps {
  repository: Repository;
}

const versionText = (
  version: string | null,
  iso?: string | null,
  caption?: string,
) =>
  `${version ?? '—'}${iso && caption ? ` · ${caption} ${formatDateTime(iso)}` : ''}`;

const syncText = (repository: Repository) => {
  const { sync } = repository;
  if (!sync) return '—';
  if (sync.upstream === null) return 'aucun upstream';
  if (sync.ahead === null || sync.behind === null)
    return `${sync.upstream} (inconnu)`;
  return `↑${sync.ahead} ↓${sync.behind} par rapport à ${sync.upstream}`;
};

export const GitTab = ({ repository }: GitTabProps) => {
  const { git, versions, packageManager } = repository;
  return (
    <>
      <div className="pp-git-tab-cards">
        <Card title="État Git">
          <KeyValueList
            items={[
              { label: 'Branche active', value: git?.branch ?? '—' },
              { label: 'Modifiés', value: git?.changedFiles ?? '—' },
              { label: 'Non suivis', value: git?.untrackedFiles ?? '—' },
              { label: 'Synchro', value: syncText(repository) },
              { label: 'Gestionnaire', value: packageManager.name ?? '—' },
            ]}
          />
        </Card>
        <Card title="Versions package.json">
          <KeyValueList
            items={[
              { label: 'HEAD', value: versionText(versions.head.version) },
              {
                label: 'develop',
                value: versionText(
                  versions.develop.version,
                  repository.developLastCommitAt,
                  'dernier commit distant',
                ),
              },
              { label: 'main', value: versionText(versions.main.version) },
            ]}
          />
        </Card>
      </div>
      <GitBar repository={repository} />
    </>
  );
};
