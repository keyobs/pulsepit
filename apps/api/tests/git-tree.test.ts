import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { GitTreeResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function commit(
  path: string,
  message: string,
  date: string,
  author = 'Ada',
) {
  await execute(
    'git',
    [
      '-c',
      `user.name=${author}`,
      '-c',
      'user.email=tree@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-m',
      message,
    ],
    {
      cwd: path,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    },
  );
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-git-tree-'));
  const path = join(root, 'project');
  await execute('git', ['init', '--initial-branch=main', path]);
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const tree = async (target = path) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/git-tree?path=${encodeURIComponent(target)}`,
    });
    return { status: response.statusCode, body: response.json() };
  };
  return { path, tree };
}

test('lists the last 10 origin/main commits and the 3 newest origin branches', async (t) => {
  const { path, tree } = await fixture(t);
  for (let day = 1; day <= 12; day += 1)
    await commit(
      path,
      `main ${day}`,
      `2025-01-${String(day).padStart(2, '0')}T10:00:00Z`,
    );
  await git(path, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await commit(path, 'local only', '2025-02-01T10:00:00Z');

  const branches = [
    ['old', '2025-03-01', 'Bob'],
    ['feature/a', '2025-03-05', 'Cy'],
    ['feature/b', '2025-03-03', 'Dee'],
    ['fix/c', '2025-03-04', 'Eve'],
  ] as const;
  for (const [name, day, author] of branches) {
    await git(
      path,
      'checkout',
      '-q',
      '-b',
      `tmp-${name}`,
      'refs/remotes/origin/main',
    );
    await commit(path, `${name} first`, `${day}T09:00:00Z`, author);
    await commit(path, `${name} later`, '2025-04-01T09:00:00Z', 'Zed');
    await git(path, 'update-ref', `refs/remotes/origin/${name}`, 'HEAD');
  }
  await git(
    path,
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  );

  const { status, body } = await tree();
  assert.equal(status, 200);
  const parsed = GitTreeResponse.parse(body);
  assert.equal(parsed.mainRef, 'origin/main');
  assert.equal(parsed.commits.length, 10);
  assert.equal(parsed.commits[0]?.subject, 'main 12');
  assert.equal(parsed.commits[0]?.author, 'Ada');
  assert.equal(parsed.commits[0]?.date, '2025-01-12T10:00:00.000Z');
  assert.match(parsed.commits[0]?.hash ?? '', /^[0-9a-f]{40}$/);
  assert.deepEqual(
    parsed.branches.map(({ name, author, createdAt, merged }) => [
      name,
      author,
      createdAt,
      merged,
    ]),
    [
      ['feature/a', 'Cy', '2025-03-05T09:00:00.000Z', false],
      ['fix/c', 'Eve', '2025-03-04T09:00:00.000Z', false],
      ['feature/b', 'Dee', '2025-03-03T09:00:00.000Z', false],
    ],
  );
});

test('flags branches contained in main, except fresh ones at the main tip', async (t) => {
  const { path, tree } = await fixture(t);
  await commit(path, 'one', '2025-01-01T10:00:00Z');
  await git(path, 'update-ref', 'refs/remotes/origin/done', 'HEAD');
  await commit(path, 'two', '2025-01-02T10:00:00Z');
  await git(path, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(path, 'update-ref', 'refs/remotes/origin/fresh', 'HEAD');

  const parsed = GitTreeResponse.parse((await tree()).body);
  assert.deepEqual(
    Object.fromEntries(parsed.branches.map((b) => [b.name, b.merged])),
    { done: true, fresh: false },
  );
});

test('falls back to local main and returns empty lists without remotes', async (t) => {
  const { path, tree } = await fixture(t);
  await commit(path, 'only', '2025-01-01T10:00:00Z');

  const { status, body } = await tree();
  assert.equal(status, 200);
  const parsed = GitTreeResponse.parse(body);
  assert.equal(parsed.mainRef, 'main');
  assert.equal(parsed.commits.length, 1);
  assert.deepEqual(parsed.branches, []);
});

test('returns 404 outside configured scan paths', async (t) => {
  const { tree } = await fixture(t);
  assert.equal((await tree('/nowhere')).status, 404);
});
