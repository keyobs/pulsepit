import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function getDevelopLastCommitAt(
  repositoryPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execute(
      'git',
      [
        'log',
        '-1',
        '--no-show-signature',
        '--format=%ct',
        'refs/remotes/origin/develop',
        '--',
      ],
      {
        cwd: repositoryPath,
        timeout: 5_000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_NO_LAZY_FETCH: '1',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'Never',
        },
      },
    );
    const timestamp = stdout.trim();
    if (!/^-?\d+$/.test(timestamp)) return null;
    const date = new Date(Number(timestamp) * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}
