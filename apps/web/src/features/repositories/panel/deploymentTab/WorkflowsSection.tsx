import { Card } from '@components/card/Card';
import { Chip } from '@components/chip/Chip';
import {
  DataTable,
  type DataTableColumn,
} from '@components/dataTable/DataTable';
import { EmptyState } from '@components/emptyState/EmptyState';
import { Spinner } from '@components/spinner/Spinner';
import { useWorkflows } from '@hooks/useWorkflows';
import { describeApiError } from '@utils/describeApiError';
import { useEffect } from 'react';
import { toWorkflowRow, type WorkflowRow } from './workflowRow';
import './workflowsSection.less';

const COLUMNS: DataTableColumn<WorkflowRow>[] = [
  {
    key: 'name',
    header: 'Workflow',
    render: (row) => (
      <>
        {row.name}
        <div className="pp-workflows-section-file">{row.file}</div>
      </>
    ),
  },
  {
    key: 'triggers',
    header: 'Déclencheurs',
    render: (row) => row.triggers,
    mono: true,
  },
  {
    key: 'branches',
    header: 'Branches',
    render: (row) => row.branches,
    mono: true,
  },
  { key: 'jobs', header: 'Jobs', render: (row) => row.jobs, mono: true },
  {
    key: 'kind',
    header: '',
    render: (row) => (
      <Chip variant={row.kind.variant} title={row.kind.title}>
        {row.kind.label}
      </Chip>
    ),
  },
];

interface WorkflowsSectionProps {
  path: string;
}

/** Workflows CI/CD détectés dans le dépôt (GitHub Actions analysé, GitLab CI détecté). */
export const WorkflowsSection = ({ path }: WorkflowsSectionProps) => {
  const { data, status, error, run } = useWorkflows(path);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <Card title="Workflows du dépôt">
      {status === 'error' ? (
        <EmptyState>{describeApiError(error)}</EmptyState>
      ) : !data ? (
        <EmptyState>
          <Spinner /> Analyse des workflows…
        </EmptyState>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={data.workflows.map(toWorkflowRow)}
          getRowKey={(row) => row.key}
          emptyText="Aucun workflow : ni .github/workflows ni .gitlab-ci.yml dans ce dépôt."
        />
      )}
    </Card>
  );
};
