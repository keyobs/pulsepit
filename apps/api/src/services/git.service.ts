import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';

const execute = promisify(execFile);

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
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
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

export interface GitStatus {
  branch: string | null;
  isClean: boolean;
  changedFiles: number;
  untrackedFiles: number;
}

export async function getGitStatus(repositoryPath: string): Promise<GitStatus> {
  const git = simpleGit({
    baseDir: repositoryPath,
    timeout: { block: 10_000 },
  });
  const status = await git.status(['--untracked-files=all']);
  const untrackedFiles = status.not_added.length;

  return {
    branch: status.detached ? null : status.current || null,
    isClean: status.isClean(),
    changedFiles: status.files.length - untrackedFiles,
    untrackedFiles,
  };
}
