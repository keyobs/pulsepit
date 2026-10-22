import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
class PushTimeoutError extends Error {}

export type GitPushResult =
  | { success: true }
  | {
      success: false;
      code:
        | 'INVALID_BRANCH'
        | 'BRANCH_NOT_FOUND'
        | 'REMOTE_NOT_FOUND'
        | 'NON_FAST_FORWARD'
        | 'REMOTE_REJECTED'
        | 'AUTHENTICATION_FAILED'
        | 'LOCAL_HOOK_FAILED'
        | 'PUSH_FAILED'
        | 'TIMEOUT';
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
        LC_ALL: 'C',
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

    try {
      await run(['remote', 'get-url', '--push', 'origin']);
    } catch (error) {
      if ((error as { code?: number }).code !== 2) throw error;
      return {
        success: false,
        code: 'REMOTE_NOT_FOUND',
        error: 'No origin remote is configured for this repository.',
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
    const failure = error as { stdout?: string; stderr?: string };
    const output = failure.stdout ?? '';
    if (
      /(?:^|\n)husky - pre-push script failed \(code [1-9]\d*\)\r?(?:\n|$)/.test(
        `${output}\n${failure.stderr ?? ''}`,
      )
    ) {
      return {
        success: false,
        code: 'LOCAL_HOOK_FAILED',
        error:
          'The local pre-push hook rejected the push. Check the repository lint and tests in a terminal.',
      };
    }
    // Parse only porcelain rejection records; free-form server messages may
    // contain similar words without describing the actual push result.
    const rejections = output
      .split('\n')
      .filter((line) => line.startsWith('!\t'));
    if (
      rejections.some((line) =>
        /\t\[rejected\] \((?:non-fast-forward|fetch first)\)$/.test(line),
      )
    ) {
      return {
        success: false,
        code: 'NON_FAST_FORWARD',
        error:
          'The remote branch contains commits missing locally. Fetch and integrate them before pushing.',
      };
    }
    if (rejections.some((line) => /\t\[remote rejected\] \(.+\)$/.test(line))) {
      return {
        success: false,
        code: 'REMOTE_REJECTED',
        error:
          'The remote server rejected the push. Check branch protection rules and server policies.',
      };
    }
    if (
      /fatal: Authentication failed|fatal: could not read (?:Username|Password)|Permission denied \((?:publickey|password)[^)]*\)|fatal:.*requested URL returned error: 401/i.test(
        failure.stderr ?? '',
      )
    ) {
      return {
        success: false,
        code: 'AUTHENTICATION_FAILED',
        error:
          'Git authentication failed. Check the credentials or SSH key used for origin.',
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
