import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import type { Settings } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { GitRescanService } from '../src/services/git/git-rescan.service.js';

const execute = promisify(execFile);

test('settings persistence, scan paths and push locks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-settings-'));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const repository = join(second, 'repo');
  const configPath = join(root, 'config', 'config.json');
  await mkdir(first);
  await mkdir(repository, { recursive: true });
  const git = (...args: string[]) => execute('git', args, { cwd: repository });
  await git('init', '--initial-branch=main');
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
  const app = buildApp({ port: 3001, scanPaths: [first], configPath });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const settings: Settings = {
    scanPaths: [second],
    rescan: { enabled: false, interval: '1h' },
    pushLocks: {
      all: false,
      branches: [],
      repositories: { [repository]: { all: false, branches: ['main'] } },
    },
  };

  await t.test('returns defaults and rejects invalid settings', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/settings' });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().scanPathsSource, 'env');
    assert.deepEqual(initial.json().effectiveScanPaths, [first]);

    for (const body of [
      { ...settings, scanPaths: ['relative'] },
      { ...settings, scanPaths: [join(root, 'missing')] },
      { ...settings, pushLocks: { ...settings.pushLocks, branches: ['a..b'] } },
      { ...settings, unknown: true },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: body,
      });
      assert.equal(response.statusCode, 422);
    }
  });

  await t.test('persists settings and applies scan paths', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: settings,
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().scanPathsSource, 'settings');
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'config', 'settings.json'), 'utf8')),
      settings,
    );
    const list = await app.inject({ method: 'GET', url: '/api/repositories' });
    assert.deepEqual(
      list.json().repositories.map((entry: { path: string }) => entry.path),
      [repository],
    );

    const reloaded = buildApp({ port: 3001, scanPaths: [first], configPath });
    await reloaded.ready();
    const response = await reloaded.inject({
      method: 'GET',
      url: '/api/settings',
    });
    await reloaded.close();
    assert.deepEqual(response.json().effectiveScanPaths, [second]);
  });

  await t.test('blocks locked branches before pushing', async () => {
    const push = await app.inject({
      method: 'POST',
      url: '/api/repositories/push',
      payload: { path: repository, branch: 'main' },
    });
    assert.equal(push.statusCode, 403);
    assert.equal(push.json().code, 'PUSH_LOCKED');

    const branches = await app.inject({
      method: 'GET',
      url: `/api/repositories/branches?path=${encodeURIComponent(repository)}`,
    });
    const main = branches
      .json()
      .branches.find((branch: { name: string }) => branch.name === 'main');
    assert.equal(main.pushAssessment.reasons[0].code, 'PUSH_LOCKED');
  });
});

test('rescan fetches every repository and records failures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-rescan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['a', 'b']) {
    await mkdir(join(root, name));
    await execute('git', ['init'], { cwd: join(root, name) });
  }
  const fetched: string[] = [];
  const rescan = new GitRescanService([root], async (path) => {
    fetched.push(path);
    return path.endsWith('b')
      ? { success: false, code: 'TIMEOUT', error: 'timeout' }
      : { success: true };
  });
  rescan.configure({ enabled: false, interval: '15m' });
  await rescan.run();
  await rescan.close();
  const state = rescan.snapshot();
  assert.deepEqual(fetched.sort(), [join(root, 'a'), join(root, 'b')]);
  assert.deepEqual(state.failures, [
    { path: join(root, 'b'), code: 'TIMEOUT' },
  ]);
  assert.ok(state.lastStartedAt && state.lastFinishedAt);
});
