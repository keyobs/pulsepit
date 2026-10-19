import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ListRepositoriesResponse, RepositorySync } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { getGitSync } from '../src/services/git-sync.service.js';

const execute = promisify(execFile);
const withoutUpstream = { upstream: null, ahead: null, behind: null };

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function commit(path: string, message: string) {
  await git(
    path,
    '-c',
    'user.name=Sync Test',
    '-c',
    'user.email=sync@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    message,
  );
  return git(path, 'rev-parse', 'HEAD');
}

async function repository(root: string, name: string, committed = true) {
  const path = join(root, name);
  await execute('git', ['init', '--initial-branch=main', path]);
  if (committed) await commit(path, 'Initial commit');
  return path;
}

async function track(
  path: string,
  remote = 'origin',
  branch = 'main',
  upstream = 'main',
) {
  await git(
    path,
    'remote',
    'add',
    remote,
    `https://example.invalid/${remote}.git`,
  );
  await git(path, 'config', `branch.${branch}.remote`, remote);
  await git(path, 'config', `branch.${branch}.merge`, `refs/heads/${upstream}`);
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-git-sync-'));
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

test('counts equal, ahead, divergent and behind histories using local refs and exposes sync through the API', async (t) => {
  const { root, list } = await fixture(t);
  const path = await repository(root, 'project');
  const base = await git(path, 'rev-parse', 'HEAD');
  await track(path);
  await git(path, 'update-ref', 'refs/remotes/origin/main', base);
  assert.deepEqual(await getGitSync(path, 'main'), {
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
  });

  await commit(path, 'Local commit');
  assert.deepEqual(await getGitSync(path, 'main'), {
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
  });

  await git(path, 'checkout', '-b', 'remote-work', base);
  const remoteTip = await commit(path, 'Remote-only commit');
  await git(path, 'update-ref', 'refs/remotes/origin/main', remoteTip);
  await git(path, 'checkout', 'main');
  assert.deepEqual(await getGitSync(path, 'main'), {
    upstream: 'origin/main',
    ahead: 1,
    behind: 1,
  });
  const [result] = await list();
  assert.deepEqual(result.sync, {
    upstream: 'origin/main',
    ahead: 1,
    behind: 1,
  });
  assert.equal(
    await git(path, 'rev-parse', 'refs/remotes/origin/main'),
    remoteTip,
  );

  await git(path, 'update-ref', 'refs/heads/main', base);
  assert.deepEqual(await getGitSync(path, 'main'), {
    upstream: 'origin/main',
    ahead: 0,
    behind: 1,
  });
  assert.equal(
    RepositorySync.safeParse({ upstream: 'origin/main', ahead: -1, behind: 0 })
      .success,
    false,
  );
});

test('distinguishes absent tracking, unborn or detached HEAD, a missing upstream ref and unreadable Git state', async (t) => {
  const { root, list } = await fixture(t);
  const noTracking = await repository(root, 'no-tracking');
  const unborn = await repository(root, 'unborn', false);
  const gone = await repository(root, 'gone');
  await track(gone);
  const detached = await repository(root, 'detached');
  await track(detached);
  await git(detached, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(detached, 'checkout', '--detach');
  const broken = join(root, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });

  const results = new Map((await list()).map((repo) => [repo.path, repo]));
  assert.deepEqual(results.get(noTracking)?.sync, withoutUpstream);
  assert.deepEqual(results.get(unborn)?.sync, withoutUpstream);
  assert.equal(results.get(detached)?.git?.branch, null);
  assert.deepEqual(results.get(detached)?.sync, withoutUpstream);
  assert.deepEqual(results.get(gone)?.sync, {
    upstream: 'origin/main',
    ahead: null,
    behind: null,
  });
  assert.equal(results.get(broken)?.git, null);
  assert.equal(results.get(broken)?.sync, null);
  assert.equal(await getGitSync(broken, 'main'), null);
});

test('reads a worktree branch tracking a different remote and upstream branch', async (t) => {
  const { root, list } = await fixture(t);
  const primary = await repository(root, 'primary');
  const worktree = join(root, 'worktree');
  await git(primary, 'worktree', 'add', '-b', 'feature/sync', worktree, 'main');
  await track(worktree, 'secondary', 'feature/sync', 'trunk');
  await git(primary, 'update-ref', 'refs/remotes/secondary/trunk', 'HEAD');

  const results = await list();
  const result = results.find((repo) => repo.path === worktree);
  assert.equal(result?.git?.branch, 'feature/sync');
  assert.deepEqual(result?.sync, {
    upstream: 'secondary/trunk',
    ahead: 0,
    behind: 0,
  });
  assert.deepEqual(
    results.find((repo) => repo.path === primary)?.sync,
    withoutUpstream,
  );
});
