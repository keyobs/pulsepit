import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCommandEnvironment } from './command-environment.service.js';

const execute = promisify(execFile);

async function readCommitDate(
  repositoryPath: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await execute('git', args, {
      cwd: repositoryPath,
      timeout: 5_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024,
      encoding: 'utf8',
      env: {
        ...createCommandEnvironment('git'),
        GIT_NO_LAZY_FETCH: '1',
      },
    });
    const timestamp = stdout.trim();
    if (!/^-?\d+$/.test(timestamp)) return null;
    const date = new Date(Number(timestamp) * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

export function getDevelopLastCommitAt(
  repositoryPath: string,
): Promise<string | null> {
  return readCommitDate(repositoryPath, [
    'log',
    '-1',
    '--no-show-signature',
    '--format=%ct',
    'refs/remotes/origin/develop',
    '--',
  ]);
}

export function getLastActivityAt(
  repositoryPath: string,
): Promise<string | null> {
  return readCommitDate(repositoryPath, [
    'for-each-ref',
    '--sort=-committerdate',
    '--count=1',
    '--format=%(committerdate:unix)',
    'refs/heads/',
    'refs/remotes/',
  ]);
}
