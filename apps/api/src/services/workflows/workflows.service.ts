import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ScanError,
  WorkflowEntry,
  WorkflowsResponse,
} from '@pulsepit/contracts';
import { analyzeGithubWorkflow } from './github-workflow.service.js';

export type WorkflowFile = Pick<WorkflowEntry, 'provider' | 'file'>;

export type WorkflowScanError = ScanError;

export interface WorkflowDiscovery {
  workflows: WorkflowFile[];
  errors: WorkflowScanError[];
}

export async function getRepositoryWorkflows(
  repositoryPath: string,
): Promise<Omit<WorkflowsResponse, 'path'>> {
  const discovered = await findWorkflowFiles(repositoryPath);
  const workflows: WorkflowEntry[] = [];
  // Process files sequentially to bound file buffers and preserve discovery order.
  for (const workflow of discovered.workflows) {
    workflows.push(
      workflow.provider === 'github-actions'
        ? {
            ...workflow,
            provider: 'github-actions',
            ...(await analyzeGithubWorkflow(repositoryPath, workflow.file)),
          }
        : { ...workflow, provider: 'gitlab-ci' },
    );
  }
  return { workflows, errors: discovered.errors };
}

export async function findWorkflowFiles(
  repositoryPath: string,
): Promise<WorkflowDiscovery> {
  const workflows: WorkflowFile[] = [];
  const errors: WorkflowScanError[] = [];

  function recordError(path: string, error: unknown) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    if (code === 'ENOENT') return;
    errors.push({
      path,
      code,
      message: 'Unable to inspect the workflow path.',
    });
  }

  async function directory(path: string): Promise<boolean> {
    try {
      const entry = await lstat(join(repositoryPath, path));
      if (entry.isDirectory()) return true;
      errors.push({
        path,
        code: 'UNSUPPORTED_PATH',
        message:
          'Workflow directories must be directories and must not be symbolic links.',
      });
    } catch (error) {
      recordError(path, error);
    }
    return false;
  }

  const githubPath = '.github/workflows';
  if ((await directory('.github')) && (await directory(githubPath))) {
    try {
      const entries = await readdir(join(repositoryPath, githubPath), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!/\.(yml|yaml)$/.test(entry.name)) continue;
        const file = `${githubPath}/${entry.name}`;
        if (entry.isFile())
          workflows.push({ provider: 'github-actions', file });
        else if (entry.isSymbolicLink())
          errors.push({
            path: file,
            code: 'UNSUPPORTED_PATH',
            message: 'Workflow files must not be symbolic links.',
          });
      }
    } catch (error) {
      recordError(githubPath, error);
    }
  }

  const gitlabFile = '.gitlab-ci.yml';
  try {
    const entry = await lstat(join(repositoryPath, gitlabFile));
    if (entry.isFile())
      workflows.push({ provider: 'gitlab-ci', file: gitlabFile });
    else
      errors.push({
        path: gitlabFile,
        code: 'UNSUPPORTED_PATH',
        message:
          'The GitLab CI configuration must be a regular file and must not be a symbolic link.',
      });
  } catch (error) {
    recordError(gitlabFile, error);
  }

  return {
    workflows: workflows.sort((a, b) => a.file.localeCompare(b.file)),
    errors,
  };
}
