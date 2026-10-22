import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  GithubWorkflowAnalysis,
  GithubWorkflowResult,
} from '@pulsepit/contracts';
import { parseDocument } from 'yaml';
import {
  InvalidDeploymentMetadata,
  inspectGithubDeployments,
} from './github-deployment.service.js';

export type {
  GithubWorkflowAnalysis,
  GithubWorkflowResult,
} from '@pulsepit/contracts';

class InvalidWorkflow extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new InvalidWorkflow(
      'Workflow events and branch filters must contain non-empty strings.',
    );
  }
  return [...new Set(value as string[])];
}

export function parseGithubWorkflow(
  content: string,
  file: string,
): GithubWorkflowResult {
  let data: unknown;
  try {
    // YAML 1.2 core keeps "on" as a string key rather than a YAML 1.1 boolean.
    const document = parseDocument(content, {
      version: '1.2',
      schema: 'core',
      stringKeys: true,
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length)
      throw new Error('Invalid YAML.');
    data = document.toJS({ maxAliasCount: 100 });
  } catch {
    return {
      analysis: null,
      analysisError: {
        code: 'INVALID_YAML',
        message: 'Unable to parse the workflow as supported YAML.',
      },
    };
  }

  try {
    if (!object(data))
      throw new InvalidWorkflow('The workflow must contain a YAML mapping.');
    if (data.name !== undefined && typeof data.name !== 'string')
      throw new InvalidWorkflow('The workflow name must be a string.');
    const name =
      typeof data.name === 'string' && data.name.trim() ? data.name : file;
    const branchFilters: GithubWorkflowAnalysis['branchFilters'] = {};
    let events: string[];
    if (typeof data.on === 'string' && data.on.trim()) events = [data.on];
    else if (Array.isArray(data.on)) events = strings(data.on);
    else if (object(data.on)) {
      events = Object.keys(data.on);
      for (const [event, options] of Object.entries(data.on)) {
        if (options !== null && !object(options) && !Array.isArray(options)) {
          throw new InvalidWorkflow(
            'Workflow event settings must be mappings, schedules or null.',
          );
        }
        if (!object(options)) continue;
        const include =
          options.branches === undefined ? [] : strings(options.branches);
        const exclude =
          options['branches-ignore'] === undefined
            ? []
            : strings(options['branches-ignore']);
        if (
          options.branches !== undefined &&
          options['branches-ignore'] !== undefined
        ) {
          throw new InvalidWorkflow(
            'An event cannot define both branches and branches-ignore.',
          );
        }
        if (
          options.branches !== undefined ||
          options['branches-ignore'] !== undefined
        ) {
          Object.defineProperty(branchFilters, event, {
            value: { include, exclude },
            enumerable: true,
          });
        }
      }
    } else
      throw new InvalidWorkflow(
        'The workflow must declare triggering events in on.',
      );
    if (!events.length || events.some((event) => !event.trim()))
      throw new InvalidWorkflow(
        'The workflow must declare at least one event.',
      );
    if (
      !object(data.jobs) ||
      !Object.keys(data.jobs).length ||
      !Object.values(data.jobs).every(object)
    ) {
      throw new InvalidWorkflow(
        'The workflow must declare jobs as a non-empty mapping of job definitions.',
      );
    }
    return {
      analysis: {
        name,
        on: events,
        branches: [
          ...new Set(
            Object.values(branchFilters).flatMap((filter) => filter.include),
          ),
        ],
        branchFilters,
        jobs: Object.keys(data.jobs),
        ...inspectGithubDeployments(data.jobs),
      },
      analysisError: null,
    };
  } catch (error) {
    return {
      analysis: null,
      analysisError: {
        code: 'INVALID_WORKFLOW',
        message:
          error instanceof InvalidWorkflow ||
          error instanceof InvalidDeploymentMetadata
            ? error.message
            : 'Unable to extract workflow metadata.',
      },
    };
  }
}

export async function analyzeGithubWorkflow(
  repositoryPath: string,
  file: string,
): Promise<GithubWorkflowResult> {
  const limit = 1024 * 1024;
  try {
    const handle = await open(
      join(repositoryPath, file),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!(await handle.stat()).isFile())
        throw new Error('Not a regular file.');
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          size,
          buffer.length - size,
          null,
        );
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > limit)
        return {
          analysis: null,
          analysisError: {
            code: 'FILE_TOO_LARGE',
            message: 'Workflow files must not exceed 1 MiB.',
          },
        };
      return parseGithubWorkflow(
        buffer.subarray(0, size).toString('utf8'),
        file,
      );
    } finally {
      await handle.close();
    }
  } catch {
    return {
      analysis: null,
      analysisError: {
        code: 'READ_FAILED',
        message: 'Unable to read the workflow as a regular local file.',
      },
    };
  }
}
