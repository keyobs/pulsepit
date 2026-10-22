import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

test('list local branches for one configured repository', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-branches-'));
  const projects = join(root, 'projects');
  const repository = join(projects, 'repository');
  await mkdir(repository, { recursive: true });
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function git(...args: string[]) {
    return (await execute('git', args, { cwd: repository })).stdout.trim();
  }
  const url = (path = repository) =>
    `/api/repositories/branches?${new URLSearchParams({ path })}`;
  await git('init', '--initial-branch=main');

  await t.test('returns an empty list before the first commit', async () => {
    const response = await app.inject({ method: 'GET', url: url() });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { path: repository, branches: [] });
  });

  await git(
    '-c',
    'user.name=Pulsepit Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'Initial',
  );
  await git('branch', 'develop');
  await git('branch', 'feature/example');
  await git('update-ref', 'refs/remotes/origin/remote-only', 'HEAD');

  await t.test(
    'sorts local branches, identifies the active one and excludes remote refs',
    async () => {
      const before = await git('rev-parse', 'HEAD');
      const response = await app.inject({ method: 'GET', url: url() });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(
        response
          .json()
          .branches.map(
            ({ name, isCurrent }: { name: string; isCurrent: boolean }) => ({
              name,
              isCurrent,
            }),
          ),
        [
          { name: 'develop', isCurrent: false },
          { name: 'feature/example', isCurrent: false },
          { name: 'main', isCurrent: true },
        ],
      );
      assert.equal(await git('rev-parse', 'HEAD'), before);
      assert.equal(await git('symbolic-ref', '--short', 'HEAD'), 'main');
    },
  );

  await t.test('marks no branch as current in detached HEAD', async () => {
    await git('checkout', '--detach');
    const response = await app.inject({ method: 'GET', url: url() });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().branches.length, 3);
    assert.ok(
      response
        .json()
        .branches.every((branch: { isCurrent: boolean }) => !branch.isCurrent),
    );
    await git('checkout', 'main');
  });

  await t.test('identifies the active branch of a Git worktree', async () => {
    const worktree = join(projects, 'worktree');
    await git('worktree', 'add', '-b', 'preview', worktree, 'main');
    const response = await app.inject({ method: 'GET', url: url(worktree) });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response
        .json()
        .branches.filter((branch: { isCurrent: boolean }) => branch.isCurrent)
        .map(({ name, isCurrent }: { name: string; isCurrent: boolean }) => ({
          name,
          isCurrent,
        })),
      [{ name: 'preview', isCurrent: true }],
    );
  });

  await t.test(
    'rejects missing parameters and paths outside configured repositories',
    async () => {
      for (const target of [
        '/api/repositories/branches',
        url(''),
        url('   '),
      ]) {
        assert.equal(
          (await app.inject({ method: 'GET', url: target })).statusCode,
          400,
        );
      }
      for (const path of [root, projects, join(projects, 'missing')]) {
        assert.equal(
          (await app.inject({ method: 'GET', url: url(path) })).statusCode,
          404,
        );
      }
    },
  );

  await t.test('reports invalid Git repositories in English', async () => {
    const broken = join(projects, 'broken');
    await mkdir(join(broken, '.git'), { recursive: true });
    const response = await app.inject({ method: 'GET', url: url(broken) });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().code, 'BRANCHES_FAILED');
    assert.equal(
      response.json().error,
      'Unable to read local branches for this repository.',
    );
  });
});
