import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ListRepositoriesResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { getDevelopLastCommitAt } from '../src/services/git-commit.service.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function repository(root: string, name: string) {
  const path = join(root, name);
  await execute('git', ['init', '--initial-branch=main', path]);
  return path;
}

async function commit(path: string, date: string) {
  await execute(
    'git',
    [
      '-c',
      'user.name=Commit Date Test',
      '-c',
      'user.email=commit-date@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-m',
      'Dated commit',
    ],
    {
      cwd: path,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: date,
      },
    },
  );
  return git(path, 'rev-parse', 'HEAD');
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-develop-date-'));
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function list() {
    const response = await app.inject({
      method: 'GET',
      url: '/api/repositories',
    });
    assert.equal(response.statusCode, 200);
    const parsed = ListRepositoriesResponse.parse(response.json());
    assert.deepEqual(parsed, response.json());
    return parsed.repositories;
  }
  return { root, list };
}

test('exposes the origin/develop committer date in UTC, independently of author, HEAD and worktree', async (t) => {
  const { root, list } = await fixture(t);
  const path = await repository(root, 'project');
  const remoteCommit = await commit(path, '2024-02-03T10:15:30+05:30');
  await git(
    path,
    'remote',
    'add',
    'origin',
    'https://example.invalid/project.git',
  );
  await git(path, 'update-ref', 'refs/remotes/origin/develop', remoteCommit);
  await commit(path, '2025-09-01T12:00:00Z');
  await git(path, 'branch', 'develop');
  const worktree = join(root, 'worktree');
  await git(path, 'worktree', 'add', '--detach', worktree, 'main');

  const expected = '2024-02-03T04:45:30.000Z';
  assert.equal(await getDevelopLastCommitAt(path), expected);
  const results = await list();
  assert.equal(results.length, 2);
  for (const result of results)
    assert.equal(result.developLastCommitAt, expected);
  assert.equal(
    await git(path, 'rev-parse', 'refs/remotes/origin/develop'),
    remoteCommit,
  );
});

test('returns explicit null when origin/develop is missing or Git is unreadable without falling back to other refs', async (t) => {
  const { root, list } = await fixture(t);
  const path = await repository(root, 'local-only');
  await commit(path, '2025-09-01T12:00:00Z');
  await git(path, 'branch', 'develop');
  await git(path, 'update-ref', 'refs/remotes/secondary/develop', 'HEAD');
  await repository(root, 'unborn');
  const broken = join(root, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });

  const results = await list();
  assert.equal(results.length, 3);
  for (const result of results) assert.equal(result.developLastCommitAt, null);
  assert.equal(await getDevelopLastCommitAt(broken), null);
  assert.equal(results.find((result) => result.path === broken)?.git, null);
});
