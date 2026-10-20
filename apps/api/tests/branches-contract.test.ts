import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { BranchesResponse, ErrorResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);
const branchesUrl = (path: string) =>
  `/api/repositories/branches?${new URLSearchParams({ path })}`;

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-branches-contract-'));
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, app };
}

test('shared branch contract parses current, detached and unborn repository responses', async (t) => {
  const { root, app } = await fixture(t);
  const path = join(root, 'project');
  await execute('git', ['init', '--initial-branch=main', path]);
  async function readBranches() {
    const response = await app.inject({
      method: 'GET',
      url: branchesUrl(path),
    });
    assert.equal(response.statusCode, 200);
    const parsed = BranchesResponse.parse(response.json());
    assert.deepEqual(parsed, response.json());
    assert.equal(parsed.path, path);
    return parsed.branches;
  }
  assert.deepEqual(await readBranches(), []);
  await git(
    path,
    '-c',
    'user.name=Branches Contract Test',
    '-c',
    'user.email=branches-contract@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial commit',
  );
  await git(path, 'branch', 'feature/example');
  assert.deepEqual(await readBranches(), [
    { name: 'feature/example', isCurrent: false },
    { name: 'main', isCurrent: true },
  ]);
  await git(path, 'checkout', '--detach');
  assert.deepEqual(await readBranches(), [
    { name: 'feature/example', isCurrent: false },
    { name: 'main', isCurrent: false },
  ]);
});

test('shared branch contract rejects incompatible mock formats and separates API errors from empty results', async (t) => {
  for (const invalid of [
    { path: '/repos/project', branches: ['main'] },
    { path: '/repos/project', branches: [{ name: 'main' }] },
    { path: '/repos/project', branches: [{ name: 'main', isCurrent: 'true' }] },
    { path: '/repos/project', branches: null },
  ]) {
    assert.equal(BranchesResponse.safeParse(invalid).success, false);
  }
  const { root, app } = await fixture(t);
  const invalidQuery = await app.inject({
    method: 'GET',
    url: '/api/repositories/branches',
  });
  assert.equal(invalidQuery.statusCode, 400);
  assert.equal(
    ErrorResponse.parse(invalidQuery.json()).code,
    'FST_ERR_VALIDATION',
  );
  const missing = await app.inject({
    method: 'GET',
    url: branchesUrl(join(root, 'missing')),
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(typeof ErrorResponse.parse(missing.json()).error, 'string');

  const broken = join(root, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });
  const failure = await app.inject({ method: 'GET', url: branchesUrl(broken) });
  assert.equal(failure.statusCode, 502);
  assert.equal(ErrorResponse.parse(failure.json()).code, 'BRANCHES_FAILED');
  assert.equal(BranchesResponse.safeParse(failure.json()).success, false);
});
