import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitStatus, LocalBranch } from '@pulsepit/contracts';
import { createCommandEnvironment } from './command-environment.service.js';
import { createGitClient } from './git-client.service.js';

export type { GitStatus, LocalBranch } from '@pulsepit/contracts';

const execute = promisify(execFile);

export type LocalBranchesResult =
  | { branches: LocalBranch[]; error: null }
  | { code: 'BRANCHES_FAILED' | 'TIMEOUT'; error: string };

export async function getLocalBranches(
  repositoryPath: string,
): Promise<LocalBranchesResult> {
  try {
    const { stdout } = await execute(
      'git',
      [
        'for-each-ref',
        '--sort=refname',
        '--format=%(refname)%00%(HEAD)',
        'refs/heads/',
      ],
      {
        cwd: repositoryPath,
        timeout: 10_000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        env: createCommandEnvironment('git'),
      },
    );
    const branches = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, head] = line.split('\0');
        return {
          name: ref.slice('refs/heads/'.length),
          isCurrent: head === '*',
        };
      });
    return { branches, error: null };
  } catch (error) {
    if ((error as { signal?: string }).signal === 'SIGKILL') {
      return {
        code: 'TIMEOUT',
        error: 'Reading local branches timed out after 10 seconds.',
      };
    }
    return {
      code: 'BRANCHES_FAILED',
      error: 'Unable to read local branches for this repository.',
    };
  }
}

export type GitFetchResult =
  | { success: true }
  | { success: false; code: 'FETCH_FAILED' | 'TIMEOUT'; error: string };

export async function fetchRepository(
  repositoryPath: string,
): Promise<GitFetchResult> {
  try {
    await execute('git', ['fetch', '--all', '--prune'], {
      cwd: repositoryPath,
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      env: createCommandEnvironment('git'),
    });
    return { success: true };
  } catch (error) {
    if ((error as { signal?: string }).signal === 'SIGKILL') {
      return {
        success: false,
        code: 'TIMEOUT',
        error: 'Git fetch timed out after 30 seconds.',
      };
    }
    return {
      success: false,
      code: 'FETCH_FAILED',
      error:
        'Unable to fetch repository remotes. Check remote access and authentication.',
    };
  }
}

export async function getGitStatus(repositoryPath: string): Promise<GitStatus> {
  const git = createGitClient(repositoryPath);
  const status = await git.status(['--untracked-files=all']);
  const untrackedFiles = status.not_added.length;

  return {
    branch: status.detached ? null : status.current || null,
    isClean: status.isClean(),
    changedFiles: status.files.length - untrackedFiles,
    untrackedFiles,
  };
}
