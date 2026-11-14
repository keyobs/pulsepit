import { Card } from '@components/card/Card';
import { Chip } from '@components/chip/Chip';
import { CopyButton } from '@components/copyButton/CopyButton';
import {
  DataTable,
  type DataTableColumn,
} from '@components/dataTable/DataTable';
import { EmptyState } from '@components/emptyState/EmptyState';
import { Spinner } from '@components/spinner/Spinner';
import { useGitTree } from '@hooks/useGitTree';
import type { GitBranchSummary, GitCommitSummary } from '@pulsepit/contracts';
import { describeApiError } from '@utils/describeApiError';
import { formatDateTime } from '@utils/formatDate';
import './gitTreeTab.less';

const CommitHash = ({ commit }: { commit: GitCommitSummary }) => (
  <span className="pp-git-tree-tab-hash" title={commit.hash}>
    {commit.shortHash}
    <CopyButton value={commit.hash} label="Copier le hash" />
  </span>
);

const COMMIT_COLUMNS: DataTableColumn<GitCommitSummary>[] = [
  { key: 'date', header: 'Date', render: (row) => formatDateTime(row.date) },
  {
    key: 'hash',
    header: 'Commit',
    render: (row) => <CommitHash commit={row} />,
    mono: true,
  },
  { key: 'subject', header: 'Titre', render: (row) => row.subject },
  { key: 'author', header: 'Auteur', render: (row) => row.author },
];

const BRANCH_COLUMNS: DataTableColumn<GitBranchSummary>[] = [
  {
    key: 'name',
    header: 'Branche',
    render: (row) => (
      <span className="pp-git-tree-tab-branch">
        {row.name}
        {row.merged && (
          <Chip variant="ok" title="Contenue dans main">
            merged
          </Chip>
        )}
      </span>
    ),
    mono: true,
  },
  {
    key: 'createdAt',
    header: <span title="Date du premier commit absent de main">Créée le</span>,
    render: (row) => formatDateTime(row.createdAt),
  },
  { key: 'author', header: 'Auteur', render: (row) => row.author },
  {
    key: 'lastCommit',
    header: 'Dernier commit',
    render: ({ lastCommit }) => (
      <>
        <span className="pp-git-tree-tab-last">
          <CommitHash commit={lastCommit} />
          {lastCommit.subject}
        </span>
        <div className="pp-git-tree-tab-meta">
          {formatDateTime(lastCommit.date)} · {lastCommit.author}
        </div>
      </>
    ),
  },
];

interface GitTreeTabProps {
  path: string;
}

/** Derniers commits de main et dernières branches distantes créées. */
export const GitTreeTab = ({ path }: GitTreeTabProps) => {
  const { data, status, error } = useGitTree(path);

  if (status === 'error')
    return <EmptyState>{describeApiError(error)}</EmptyState>;
  if (!data)
    return (
      <EmptyState>
        <Spinner /> Lecture de l'historique Git…
      </EmptyState>
    );

  return (
    <div className="pp-git-tree-tab">
      <Card title={`10 derniers commits · ${data.mainRef ?? 'main'}`}>
        <DataTable
          columns={COMMIT_COLUMNS}
          rows={data.commits}
          getRowKey={(row) => row.hash}
          emptyText="Aucune branche main dans ce dépôt."
        />
      </Card>
      <Card title="3 dernières branches créées · origin">
        <DataTable
          columns={BRANCH_COLUMNS}
          rows={data.branches}
          getRowKey={(row) => row.name}
          emptyText="Aucune branche distante hors main."
        />
      </Card>
    </div>
  );
};
