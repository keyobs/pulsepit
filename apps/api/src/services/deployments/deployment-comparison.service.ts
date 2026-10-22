import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  DeploymentCommitComparison,
  DeploymentEnvironment,
} from '@pulsepit/contracts';
import type { DeploymentObservation } from '../beacon/deployment-metadata.service.js';
import { createCommandEnvironment } from '../processes/command-environment.service.js';

const execute = promisify(execFile);
const fullSha = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

export type { DeploymentCommitComparison } from '@pulsepit/contracts';

type ComparisonReason = NonNullable<DeploymentCommitComparison['reason']>;

class GitReadError extends Error {
  constructor(
    readonly exitCode: unknown,
    readonly timedOut: boolean,
  ) {
    super('Unable to read local Git history.');
  }
}

export async function collectDeploymentComparisons(
  repositoryPath: string,
  environments: DeploymentObservation[],
): Promise<DeploymentEnvironment[]> {
  const results = new Array<DeploymentEnvironment>(environments.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, environments.length) }, async () => {
      while (next < environments.length) {
        const index = next++;
        const entry = environments[index];
        results[index] = {
          ...entry,
          comparison: await compareDeploymentCommit(repositoryPath, entry),
        };
      }
    }),
  );
  return results;
}

function hasExitCode(error: unknown, code: number): boolean {
  return (
    error instanceof GitReadError && !error.timedOut && error.exitCode === code
  );
}

export async function compareDeploymentCommit(
  repositoryPath: string,
  deployment: { branch: string | null; commit: string | null },
  timeoutMs = 5_000,
): Promise<DeploymentCommitComparison> {
  const reference =
    deployment.branch === null ? null : `refs/heads/${deployment.branch}`;
  let referenceCommit: string | null = null;
  const unknown = (reason: ComparisonReason): DeploymentCommitComparison => ({
    reference,
    referenceCommit,
    status: 'unknown',
    ahead: null,
    behind: null,
    reason,
  });
  if (reference === null) return unknown('BRANCH_NOT_CONFIGURED');
  if (deployment.commit === null || !fullSha.test(deployment.commit))
    return unknown('COMMIT_UNAVAILABLE');
  const commit = deployment.commit.toLowerCase();
  const deadline = Date.now() + timeoutMs;

  async function readGit(args: string[]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GitReadError(undefined, true);
    try {
      const { stdout } = await execute('git', args, {
        cwd: repositoryPath,
        timeout: remaining,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
        env: {
          ...createCommandEnvironment('git'),
          GIT_NO_LAZY_FETCH: '1',
          GIT_NO_REPLACE_OBJECTS: '1',
          GIT_OPTIONAL_LOCKS: '0',
        },
      });
      return stdout.trim();
    } catch (error) {
      const failure = error as { code?: unknown; killed?: boolean };
      throw new GitReadError(
        failure.code,
        failure.killed === true || Date.now() >= deadline,
      );
    }
  }

  try {
    try {
      await readGit(['check-ref-format', reference]);
    } catch (error) {
      if (hasExitCode(error, 1)) return unknown('INVALID_BRANCH');
      throw error;
    }
    try {
      referenceCommit = await readGit([
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        `${reference}^{commit}`,
      ]);
    } catch (error) {
      if (hasExitCode(error, 1)) return unknown('BRANCH_NOT_FOUND');
      throw error;
    }
    if (!fullSha.test(referenceCommit)) {
      referenceCommit = null;
      return unknown('GIT_ERROR');
    }
    try {
      if ((await readGit(['cat-file', '-t', commit])) !== 'commit')
        return unknown('COMMIT_NOT_FOUND');
    } catch (error) {
      if (hasExitCode(error, 128)) return unknown('COMMIT_NOT_FOUND');
      throw error;
    }
    if (commit === referenceCommit) {
      return {
        reference,
        referenceCommit,
        status: 'up_to_date',
        ahead: 0,
        behind: 0,
        reason: null,
      };
    }
    const shallow = await readGit(['rev-parse', '--is-shallow-repository']);
    if (shallow === 'true') return unknown('SHALLOW_HISTORY');
    if (shallow !== 'false') return unknown('GIT_ERROR');
    try {
      const base = await readGit([
        'merge-base',
        '--all',
        commit,
        referenceCommit,
      ]);
      if (!base.split('\n').every((sha) => fullSha.test(sha)))
        return unknown('GIT_ERROR');
    } catch (error) {
      if (hasExitCode(error, 1)) return unknown('UNRELATED_HISTORY');
      throw error;
    }
    const counts = await readGit([
      'rev-list',
      '--left-right',
      '--count',
      `${commit}...${referenceCommit}`,
      '--',
    ]);
    const match = /^(\d+)\s+(\d+)$/.exec(counts);
    if (!match) return unknown('GIT_ERROR');
    const ahead = Number(match[1]);
    const behind = Number(match[2]);
    if (
      !Number.isSafeInteger(ahead) ||
      !Number.isSafeInteger(behind) ||
      (ahead === 0 && behind === 0)
    )
      return unknown('GIT_ERROR');
    return {
      reference,
      referenceCommit,
      status: ahead === 0 ? 'behind' : behind === 0 ? 'ahead' : 'diverged',
      ahead,
      behind,
      reason: null,
    };
  } catch (error) {
    return unknown(
      error instanceof GitReadError && error.timedOut ? 'TIMEOUT' : 'GIT_ERROR',
    );
  }
}
