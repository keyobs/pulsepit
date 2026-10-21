import type { WorkflowEntry } from '@api/types';

export interface WorkflowRow {
  key: string;
  name: string;
  file: string;
  triggers: string;
  branches: string;
  jobs: string;
  kind: {
    label: string;
    variant: 'neutral' | 'ok' | 'warn' | 'bad';
    title?: string;
  };
}

const DEPLOYMENT_KINDS = {
  environment_declared: { label: 'déploie', variant: 'ok' },
  suspected: { label: 'déploiement probable', variant: 'warn' },
  unknown: { label: 'déploiement incertain', variant: 'warn' },
  not_detected: { label: 'CI', variant: 'neutral' },
} as const;

const list = (values: string[]) =>
  values.length > 0 ? values.join(', ') : '—';

/** Met à plat une entrée de workflow (GitHub analysé, GitHub en échec, GitLab non analysé) pour le tableau. */
export function toWorkflowRow(entry: WorkflowEntry): WorkflowRow {
  const base = { key: entry.file, file: entry.file };

  if (entry.provider === 'gitlab-ci') {
    return {
      ...base,
      name: entry.file,
      triggers: '—',
      branches: '—',
      jobs: '—',
      kind: {
        label: 'non analysé',
        variant: 'neutral',
        title: 'GitLab CI : fichier détecté, sans analyse',
      },
    };
  }

  if (entry.analysis === null) {
    return {
      ...base,
      name: entry.file,
      triggers: '—',
      branches: '—',
      jobs: '—',
      kind: {
        label: 'analyse impossible',
        variant: 'bad',
        title: entry.analysisError.message,
      },
    };
  }

  const { analysis } = entry;
  return {
    ...base,
    name: analysis.name,
    triggers: list(analysis.on),
    branches: list(analysis.branches),
    jobs: analysis.jobs.join(' → ') || '—',
    kind: DEPLOYMENT_KINDS[analysis.deployment.status],
  };
}
