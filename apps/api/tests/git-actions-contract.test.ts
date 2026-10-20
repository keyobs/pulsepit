import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  ErrorResponse,
  FetchRequest,
  FetchResponse,
  PushRequest,
  PushResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-git-actions-contract-'));
  const projects = join(root, 'projects');
  const path = join(projects, 'repository with spaces');
  const remote = join(root, 'origin.git');
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(projects);
  await execute('git', ['init', '--initial-branch=main', path]);
  await git(
    path,
    '-c',
    'user.name=Git Contract Test',
    '-c',
    'user.email=git-contract@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial commit',
  );
  await git(root, 'clone', '--bare', path, remote);
  await git(path, 'remote', 'add', 'origin', remote);
  return { root, path, remote, app };
}

test('Git action contracts reject malformed requests and non-success response shapes', () => {
  for (const request of [{}, { path: '' }, { path: 42 }]) {
    assert.equal(FetchRequest.safeParse(request).success, false);
  }
  for (const request of [
    { path: '/repos/project' },
    { path: '', branch: 'main' },
    { path: '/repos/project', branch: '' },
  ]) {
    assert.equal(PushRequest.safeParse(request).success, false);
  }
  assert.equal(
    FetchResponse.safeParse({
      path: '/repos/project',
      success: false,
      error: 'Failed.',
    }).success,
    false,
  );
  assert.equal(
    PushResponse.safeParse({
      path: '/repos/project',
      branch: 'main',
      remote: 'upstream',
      success: true,
    }).success,
    false,
  );
  assert.equal(
    PushResponse.safeParse({
      path: '/repos/project',
      remote: 'origin',
      success: true,
    }).success,
    false,
  );
});

test('fetch request and success contracts match the actual API and leave errors to ErrorResponse', async (t) => {
  const { root, path, app } = await fixture(t);
  const payload = FetchRequest.parse({ path: `${path}/.` });
  const response = await app.inject({
    method: 'POST',
    url: '/api/repositories/fetch',
    payload,
  });
  assert.equal(response.statusCode, 200);
  const parsed = FetchResponse.parse(response.json());
  assert.deepEqual(parsed, { path, success: true });
  assert.deepEqual(parsed, response.json());
  assert.equal(
    await git(path, 'rev-parse', 'refs/remotes/origin/main'),
    await git(path, 'rev-parse', 'HEAD'),
  );

  await git(
    path,
    'remote',
    'set-url',
    'origin',
    join(root, 'missing-remote.git'),
  );
  const failure = await app.inject({
    method: 'POST',
    url: '/api/repositories/fetch',
    payload,
  });
  assert.equal(failure.statusCode, 502);
  assert.equal(ErrorResponse.parse(failure.json()).code, 'FETCH_FAILED');
  assert.equal(FetchResponse.safeParse(failure.json()).success, false);
});

test('push request and success contracts match a selected local branch and exclude error responses', async (t) => {
  const { path, remote, app } = await fixture(t);
  const branch = 'feature/contract';
  await git(path, 'branch', branch);
  const payload = PushRequest.parse({ path, branch });
  const response = await app.inject({
    method: 'POST',
    url: '/api/repositories/push',
    payload,
  });
  assert.equal(response.statusCode, 200);
  const parsed = PushResponse.parse(response.json());
  assert.deepEqual(parsed, { path, branch, remote: 'origin', success: true });
  assert.deepEqual(parsed, response.json());
  assert.equal(
    await git(remote, 'rev-parse', `refs/heads/${branch}`),
    await git(path, 'rev-parse', `refs/heads/${branch}`),
  );

  const failure = await app.inject({
    method: 'POST',
    url: '/api/repositories/push',
    payload: PushRequest.parse({ path, branch: 'missing' }),
  });
  assert.equal(failure.statusCode, 404);
  assert.equal(ErrorResponse.parse(failure.json()).code, 'BRANCH_NOT_FOUND');
  assert.equal(PushResponse.safeParse(failure.json()).success, false);
});
