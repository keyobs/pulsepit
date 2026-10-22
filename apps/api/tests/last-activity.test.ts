import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ListRepositoriesResponse, Repository } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { getLastActivityAt } from '../src/services/git/git-commit.service.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-last-activity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function repository(name: string) {
    const path = join(root, name);
    await execute('git', ['init', '--initial-branch=main', path]);
    return path;
  }
  return { root, repository };
}

async function commit(path: string, date: string) {
  await execute(
    'git',
    [
      '-c',
      'user.name=Activity Test',
      '-c',
      'user.email=activity@example.invalid',
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

test('selects the latest branch-tip committer date across local branches and every known remote', async (t) => {
  const { repository } = await fixture(t);
  const path = await repository('project');
  const base = await commit(path, '2024-01-01T00:00:00Z');
  await git(path, 'update-ref', 'refs/remotes/origin/develop', base);
  await git(path, 'checkout', '-b', 'feature/local');
  await commit(path, '2026-02-03T10:15:30+05:30');
  await git(path, 'checkout', 'main');
  await commit(path, '2025-01-01T00:00:00Z');
  assert.equal(await getLastActivityAt(path), '2026-02-03T04:45:30.000Z');

  await git(path, 'checkout', '--detach');
  const remoteTip = await commit(path, '2027-01-01T00:00:00Z');
  await git(path, 'update-ref', 'refs/remotes/secondary/trunk', remoteTip);
  await git(path, 'checkout', 'main');
  const refs = await git(
    path,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
  );
  assert.equal(await getLastActivityAt(path), '2027-01-01T00:00:00.000Z');
  assert.equal(
    await git(path, 'for-each-ref', '--format=%(refname) %(objectname)'),
    refs,
  );
});

test('uses only branch tips, excluding historical parents, tags, stash, detached HEAD and working tree edits', async (t) => {
  const { repository } = await fixture(t);
  const path = await repository('project');
  await commit(path, '2026-01-01T00:00:00Z');
  await commit(path, '2025-01-01T00:00:00Z');
  assert.equal(await getLastActivityAt(path), '2025-01-01T00:00:00.000Z');
  await git(path, 'checkout', '--detach');
  const detached = await commit(path, '2029-01-01T00:00:00Z');
  await git(path, 'tag', 'future-tag', detached);
  await git(path, 'update-ref', 'refs/stash', detached);
  await writeFile(join(path, 'uncommitted.txt'), 'Uncommitted work.');
  assert.equal(await getLastActivityAt(path), '2025-01-01T00:00:00.000Z');
  await git(path, 'branch', '-D', 'main');
  assert.equal(await getLastActivityAt(path), null);
});

test('shares local and remote branch activity with linked worktrees', async (t) => {
  const { root, repository } = await fixture(t);
  const path = await repository('project');
  await commit(path, '2024-01-01T00:00:00Z');
  const worktree = join(root, 'linked');
  await git(
    path,
    'worktree',
    'add',
    '-b',
    'feature/worktree',
    worktree,
    'main',
  );
  await commit(worktree, '2026-07-01T00:00:00Z');
  assert.equal(await getLastActivityAt(path), '2026-07-01T00:00:00.000Z');
  assert.equal(await getLastActivityAt(worktree), '2026-07-01T00:00:00.000Z');
});

test('returns explicit null for unborn repositories, unreadable Git markers and missing directories', async (t) => {
  const { root, repository } = await fixture(t);
  const unborn = await repository('unborn');
  const broken = join(root, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });
  assert.equal(await getLastActivityAt(unborn), null);
  assert.equal(await getLastActivityAt(broken), null);
  assert.equal(await getLastActivityAt(join(root, 'missing')), null);
});

test('list and detail expose required nullable activity, refresh it from current refs and preserve develop date semantics', async (t) => {
  const { root, repository } = await fixture(t);
  const path = await repository('project');
  const base = await commit(path, '2024-01-01T00:00:00Z');
  await git(path, 'update-ref', 'refs/remotes/origin/develop', base);
  await commit(path, '2026-01-01T00:00:00Z');
  await repository('unborn');
  await mkdir(join(root, 'broken', '.git'), { recursive: true });
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(() => app.close());
  const remoteCalls = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected remote request.');
  });
  const list = await app.inject({ method: 'GET', url: '/api/repositories' });
  assert.equal(list.statusCode, 200);
  const parsed = ListRepositoriesResponse.parse(list.json());
  assert.deepEqual(parsed, list.json());
  assert.equal(parsed.repositories.length, 3);
  for (const entry of parsed.repositories) {
    const detail = await app.inject({
      method: 'GET',
      url: `/api/repositories/detail?${new URLSearchParams({ path: entry.path })}`,
    });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(Repository.parse(detail.json()), detail.json());
    assert.equal(
      entry.lastActivityAt,
      entry.path === path ? '2026-01-01T00:00:00.000Z' : null,
    );
    assert.equal(detail.json().lastActivityAt, entry.lastActivityAt);
  }
  const entry = parsed.repositories.find((item) => item.path === path);
  assert.ok(entry);
  assert.equal(entry.developLastCommitAt, '2024-01-01T00:00:00.000Z');
  assert.equal(
    Repository.safeParse({ ...entry, lastActivityAt: undefined }).success,
    false,
  );
  assert.equal(
    Repository.safeParse({ ...entry, lastActivityAt: 42 }).success,
    false,
  );
  assert.equal(
    Repository.safeParse({ ...entry, lastActivityAt: null }).success,
    true,
  );

  await commit(path, '2027-01-01T00:00:00Z');
  const updated = await app.inject({
    method: 'GET',
    url: `/api/repositories/detail?${new URLSearchParams({ path })}`,
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().lastActivityAt, '2027-01-01T00:00:00.000Z');
  assert.equal(updated.json().developLastCommitAt, entry.developLastCommitAt);
  assert.equal(remoteCalls.mock.calls.length, 0);
});
