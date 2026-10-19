import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
class PushTimeoutError extends Error {}

export type GitPushResult =
  | { success: true }
  | {
      success: false;
      code: 'INVALID_BRANCH' | 'BRANCH_NOT_FOUND' | 'PUSH_FAILED' | 'TIMEOUT';
      error: string;
    };

export async function pushRepositoryBranch(
  repositoryPath: string,
  branch: string,
): Promise<GitPushResult> {
  const deadline = Date.now() + 30_000;
  async function run(args: string[]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new PushTimeoutError();
    return execute('git', args, {
      cwd: repositoryPath,
      timeout: remaining,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
    });
  }

  try {
    const ref = `refs/heads/${branch}`;
    if (branch.startsWith('-') || branch === 'HEAD') {
      return {
        success: false,
        code: 'INVALID_BRANCH',
        error: 'Invalid local branch name.',
      };
    }
    try {
      await run(['check-ref-format', ref]);
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
      return {
        success: false,
        code: 'INVALID_BRANCH',
        error: 'Invalid local branch name.',
      };
    }
    try {
      await run(['show-ref', '--verify', '--quiet', ref]);
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
      return {
        success: false,
        code: 'BRANCH_NOT_FOUND',
        error: 'Local branch not found.',
      };
    }

    // An explicit refspec selects exactly one local and one remote branch.
    // Disable mirror and automatic tag pushes even if configured locally.
    await run([
      '-c',
      'remote.origin.mirror=false',
      'push',
      '--porcelain',
      '--no-follow-tags',
      '--',
      'origin',
      `${ref}:${ref}`,
    ]);
    return { success: true };
  } catch (error) {
    if (
      error instanceof PushTimeoutError ||
      (error as { signal?: string }).signal === 'SIGKILL'
    ) {
      return {
        success: false,
        code: 'TIMEOUT',
        error: 'Git push timed out after 30 seconds.',
      };
    }
    return {
      success: false,
      code: 'PUSH_FAILED',
      error:
        'Unable to push the branch to origin. Check remote access, authentication and remote branch history.',
    };
  }
}
