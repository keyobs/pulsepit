import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitBranchSummary, GitTreeResponse } from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';

const execute = promisify(execFile);

const COMMIT_COUNT = 10;
const BRANCH_COUNT = 3;
const BRANCH_CANDIDATES = 50;
const MAIN_REFS = ['refs/remotes/origin/main', 'refs/heads/main'];
const FIELD = '\x1f';

async function readGit(repositoryPath: string, args: string[]) {
  const { stdout } = await execute('git', args, {
    cwd: repositoryPath,
    timeout: 5_000,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...createCommandEnvironment('git'), GIT_NO_LAZY_FETCH: '1' },
  });
  return stdout;
}

const toIso = (unix: string) => {
  const date = new Date(Number(unix) * 1000);
  return /^-?\d+$/.test(unix) && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : null;
};

const lines = (output: string) =>
  output.split('\n').filter((line) => line.length > 0);

async function resolveMainRef(repositoryPath: string) {
  for (const ref of MAIN_REFS) {
    try {
      const sha = await readGit(repositoryPath, [
        'rev-parse',
        '--verify',
        '--quiet',
        `${ref}^{commit}`,
      ]);
      return { ref, sha: sha.trim() };
    } catch {}
  }
  return null;
}

async function readCommits(repositoryPath: string, mainRef: string) {
  const output = await readGit(repositoryPath, [
    'log',
    `-${COMMIT_COUNT}`,
    '--no-show-signature',
    `--format=%H${FIELD}%h${FIELD}%an${FIELD}%at${FIELD}%s`,
    mainRef,
    '--',
  ]);
  return lines(output).flatMap((line) => {
    const [hash, shortHash, author, unix, ...subject] = line.split(FIELD);
    const date = toIso(unix ?? '');
    if (!hash || !shortHash || date === null) return [];
    return [
      {
        hash,
        shortHash,
        author: author ?? '',
        date,
        subject: subject.join(FIELD),
      },
    ];
  });
}

async function firstOwnCommit(
  repositoryPath: string,
  ref: string,
  mainRef: string | null,
) {
  if (mainRef === null) return null;
  try {
    const output = await readGit(repositoryPath, [
      'log',
      '--reverse',
      '--no-show-signature',
      `--format=%an${FIELD}%at`,
      `${mainRef}..${ref}`,
      '--',
    ]);
    const [first] = lines(output);
    if (!first) return 'merged';
    const [author, unix] = first.split(FIELD);
    const createdAt = toIso(unix ?? '');
    return createdAt === null ? null : { author: author ?? '', createdAt };
  } catch {
    return null;
  }
}

async function readBranches(
  repositoryPath: string,
  main: { ref: string; sha: string } | null,
): Promise<GitBranchSummary[]> {
  const mainRef = main?.ref ?? null;
  const output = await readGit(repositoryPath, [
    'for-each-ref',
    '--sort=-committerdate',
    `--count=${BRANCH_CANDIDATES + 2}`,
    `--format=%(refname)${FIELD}%(symref)${FIELD}%(authorname)${FIELD}%(authordate:unix)${FIELD}%(objectname)${FIELD}%(objectname:short)${FIELD}%(contents:subject)`,
    'refs/remotes/origin/',
  ]);
  const candidates = lines(output)
    .map((line) => line.split(FIELD))
    .filter(([ref, symref]) => ref && !symref && ref !== mainRef)
    .slice(0, BRANCH_CANDIDATES);

  const branches = await Promise.all(
    candidates.map(async (fields) => {
      const [ref = '', , author = '', unix = '', sha = '', shortHash = ''] =
        fields;
      const found = await firstOwnCommit(repositoryPath, ref, mainRef);
      const own = typeof found === 'object' ? found : null;
      const lastCommitAt = toIso(unix);
      const createdAt = own?.createdAt ?? lastCommitAt;
      if (createdAt === null || lastCommitAt === null) return null;
      return {
        name: ref.slice('refs/remotes/origin/'.length),
        author: own?.author ?? author,
        createdAt,
        // Same tip as main: freshly created, not merged.
        merged: found === 'merged' && sha !== main?.sha,
        lastCommit: {
          hash: sha,
          shortHash,
          subject: fields.slice(6).join(FIELD),
          author,
          date: lastCommitAt,
        },
      };
    }),
  );
  return branches
    .filter((branch) => branch !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, BRANCH_COUNT);
}

export async function getGitTree(
  repositoryPath: string,
): Promise<Omit<GitTreeResponse, 'path'>> {
  const main = await resolveMainRef(repositoryPath);
  const [commits, branches] = await Promise.all([
    main === null ? [] : readCommits(repositoryPath, main.ref),
    readBranches(repositoryPath, main),
  ]);
  return {
    mainRef: main?.ref.replace(/^refs\/(remotes|heads)\//, '') ?? null,
    commits,
    branches,
  };
}
