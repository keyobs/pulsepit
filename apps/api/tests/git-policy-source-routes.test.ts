import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  BranchesResponse,
  ListRepositoriesResponse,
  Repository,
  RepositoryGitPolicy,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { parseRepositoryGitPolicies } from '../src/services/git/git-policy.service.js';

const execute = promisify(execFile);
const allowed = { directPush: 'allowed', requiredChecks: [] };
const forbidden = { directPush: 'forbidden', requiredChecks: [] };
const policy = {
  default: allowed,
  branches: { main: forbidden, develop: allowed },
};
async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-policy-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'project');
  const remote = join(root, 'remote.git');
  await execute('git', ['init', '--initial-branch=develop', path]);
  await git(
    path,
    '-c',
    'user.name=Policy Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  await git(path, 'branch', 'main');
  await git(root, 'init', '--bare', remote);
  await git(path, 'remote', 'add', 'origin', remote);
  await mkdir(join(path, '.pulsepit'));
  const file = join(path, '.pulsepit/git-policy.json');
  const setPolicy = (value: unknown = policy) =>
    writeFile(
      file,
      JSON.stringify({ version: 1, remote: 'origin', ...(value as object) }),
    );
  const appFor = async (local?: unknown) => {
    const policies = await parseRepositoryGitPolicies(
      local === undefined ? {} : { [path]: { git: { policy: local } } },
    );
    const app = buildApp(
      { port: 3001, scanPaths: [root] },
      {},
      {},
      {},
      {},
      policies,
    );
    t.after(() => app.close());
    const branches = async () =>
      BranchesResponse.parse(
        (
          await app.inject(
            `/api/repositories/branches?path=${encodeURIComponent(path)}`,
          )
        ).json(),
      ).branches;
    const push = (branch: string) =>
      app.inject({
        method: 'POST',
        url: '/api/repositories/push',
        payload: { path, branch },
      });
    return { app, branches, push };
  };
  return { root, path, file, remote, setPolicy, appFor };
}

test('repository provenance is shared by list/detail/branches; missing files fall back and conflicting declarations fail closed', async (t) => {
  const { path, setPolicy, appFor } = await fixture(t);
  const { app: legacy } = await appFor(policy);
  const legacyDetail = Repository.parse(
    (
      await legacy.inject(
        `/api/repositories/detail?path=${encodeURIComponent(path)}`,
      )
    ).json(),
  );
  assert.equal(legacyDetail.gitPolicy.source, 'local-config');
  await setPolicy();
  const { app, branches } = await appFor();
  const list = ListRepositoriesResponse.parse(
    (await app.inject('/api/repositories')).json(),
  );
  const detail = Repository.parse(
    (
      await app.inject(
        `/api/repositories/detail?path=${encodeURIComponent(path)}`,
      )
    ).json(),
  );
  assert.equal(detail.gitPolicy.source, 'repository-file');
  assert.deepEqual(
    list.repositories.find((repo) => repo.path === path)?.gitPolicy,
    detail.gitPolicy,
  );
  assert.equal(
    (await branches()).find((branch) => branch.name === 'main')?.pushAssessment
      .canAttempt,
    false,
  );
  for (const local of [policy, { default: { directPush: 'allowed' } }]) {
    const { app: conflict, push } = await appFor(local);
    const invalid = Repository.parse(
      (
        await conflict.inject(
          `/api/repositories/detail?path=${encodeURIComponent(path)}`,
        )
      ).json(),
    );
    assert.equal(invalid.gitPolicy.state, 'invalid');
    assert.equal(invalid.gitPolicy.source, null);
    const result = await push('main');
    assert.equal(result.statusCode, 422);
    assert.equal(result.json().code, 'INVALID_PUSH_POLICY');
  }
  assert.equal(
    RepositoryGitPolicy.safeParse({
      ...detail.gitPolicy,
      state: 'unconfigured',
    }).success,
    false,
  );
  assert.equal(
    RepositoryGitPolicy.safeParse({ ...detail.gitPolicy, source: 'invented' })
      .success,
    false,
  );
});

test('push re-reads policy changes and never launches hooks for new prohibitions or unavailable checks; allowed hooks remain active', async (t) => {
  const { path, remote, file, setPolicy, appFor } = await fixture(t);
  await setPolicy({ default: allowed, branches: {} });
  const { branches, push } = await appFor();
  assert.ok(
    (await branches()).every((branch) => branch.pushAssessment.canAttempt),
  );
  const marker = join(path, 'hook-input');
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    `#!/bin/sh\ncat > '${marker}'\nexit 0\n`,
    { mode: 0o755 },
  );
  await setPolicy();
  assert.equal((await push('main')).statusCode, 403);
  await assert.rejects(access(marker));
  await setPolicy({
    default: { directPush: 'allowed', requiredChecks: ['tests'] },
    branches: {},
  });
  assert.equal((await push('develop')).json().code, 'CHECK_RUNNER_UNAVAILABLE');
  await assert.rejects(access(marker));
  await writeFile(file, '{"private":"do-not-expose"');
  const invalid = await push('main');
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().code, 'INVALID_PUSH_POLICY');
  assert.equal(invalid.body.includes('do-not-expose'), false);
  await setPolicy({ default: allowed, branches: {} });
  assert.equal((await push('main')).statusCode, 200);
  assert.equal(
    await git(remote, 'rev-parse', 'main'),
    await git(path, 'rev-parse', 'main'),
  );
  assert.match(
    await readFile(marker, 'utf8'),
    /^refs\/heads\/main .* refs\/heads\/main /,
  );
});

test('all branch entries use one file snapshot even if it changes during validation', async (t) => {
  const { root, file, setPolicy, appFor } = await fixture(t);
  await setPolicy({
    default: allowed,
    branches: { main: forbidden, develop: forbidden },
  });
  const { branches } = await appFor();
  const gitExecutable = (await execute('which', ['git'])).stdout.trim();
  const bin = join(root, 'bin');
  await mkdir(bin);
  const replacement = join(root, 'changed.json');
  const calls = join(root, 'calls');
  await writeFile(
    replacement,
    JSON.stringify({ version: 1, remote: 'origin', default: allowed }),
  );
  await writeFile(
    join(bin, 'git'),
    `#!/bin/sh\nif [ "$1" = "check-ref-format" ]; then\n  printf 'read\\n' >> '${calls}'\n  cp '${replacement}' '${file}'\nfi\nexec '${gitExecutable}' "$@"\n`,
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  const entries = await branches();
  assert.ok(
    entries.every((branch) => branch.policy.directPush === 'forbidden'),
  );
  assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 2);
});

test('invalid repository files stay isolated and out-of-scope paths are rejected before policy selection', async (t) => {
  const { root, path, file, remote, setPolicy, appFor } = await fixture(t);
  await setPolicy();
  const other = join(root, 'neighbor');
  await execute('git', ['init', other]);
  const { app } = await appFor({ default: allowed });
  await writeFile(file, 'invalid-private-policy');
  const response = await app.inject('/api/repositories');
  assert.equal(response.statusCode, 200);
  const repositories = ListRepositoriesResponse.parse(
    response.json(),
  ).repositories;
  assert.equal(
    repositories.find((repo) => repo.path === path)?.gitPolicy.state,
    'invalid',
  );
  assert.equal(
    repositories.find((repo) => repo.path === other)?.gitPolicy.state,
    'unconfigured',
  );
  const detail = await app.inject(
    `/api/repositories/detail?path=${encodeURIComponent(other)}`,
  );
  assert.equal(detail.statusCode, 200);
  assert.equal(response.body.includes('invalid-private-policy'), false);
  const outside = await app.inject(
    `/api/repositories/branches?path=${encodeURIComponent(remote)}`,
  );
  assert.equal(outside.statusCode, 404);
});
