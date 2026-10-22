import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepositorySync } from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';

const execute = promisify(execFile);

async function readGit(repositoryPath: string, args: string[]) {
  const { stdout } = await execute('git', args, {
    cwd: repositoryPath,
    timeout: 5_000,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024,
    encoding: 'utf8',
    env: {
      ...createCommandEnvironment('git'),
      // Missing objects in partial clones must not trigger a network fetch.
      GIT_NO_LAZY_FETCH: '1',
    },
  });
  return stdout;
}

export async function getGitSync(
  repositoryPath: string,
  branch: string | null,
): Promise<RepositorySync | null> {
  const untracked: RepositorySync = {
    upstream: null,
    ahead: null,
    behind: null,
  };
  if (branch === null) return untracked;

  const localRef = `refs/heads/${branch}`;
  let references: string;
  try {
    references = await readGit(repositoryPath, [
      'for-each-ref',
      '--format=%(refname)%00%(upstream)%00%(upstream:short)',
      localRef,
    ]);
  } catch {
    return null;
  }
  const entry = references
    .split('\n')
    .find((line) => line.startsWith(`${localRef}\0`));
  // An unborn branch has no ref yet, and therefore no commits to compare.
  if (!entry) return untracked;
  const [, upstreamRef, upstreamName] = entry.split('\0');
  if (!upstreamRef) return untracked;
  const unknown: RepositorySync = {
    upstream: upstreamName || upstreamRef,
    ahead: null,
    behind: null,
  };

  try {
    const counts = await readGit(repositoryPath, [
      'rev-list',
      '--left-right',
      '--count',
      `${localRef}...${upstreamRef}`,
      '--',
    ]);
    const match = /^(\d+)\s+(\d+)\s*$/.exec(counts);
    if (!match) return unknown;
    const ahead = Number(match[1]);
    const behind = Number(match[2]);
    if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind))
      return unknown;
    return { upstream: unknown.upstream, ahead, behind };
  } catch {
    return unknown;
  }
}
