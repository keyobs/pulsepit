import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  BranchesResponse,
  GitBranchPolicy,
  GitCheckId,
  ListRepositoriesResponse,
  PushAssessment,
  type PushPolicyCode,
  Repository,
  RepositoryGitPolicy,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import {
  assessBranchPush,
  parseRepositoryGitPolicies,
  unconfiguredGitPolicy,
} from '../src/services/git/git-policy.service.js';
import { loadRepositoryDeploymentConfig } from '../src/services/repositories/repository-config.service.js';

const execute = promisify(execFile);
const rule = (
  directPush: 'allowed' | 'forbidden' | 'unknown',
  requiredChecks: string[] | null = [],
) => ({ directPush, requiredChecks });
async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-policy-'));
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
  await git(path, 'branch', 'feature/login');
  await git(root, 'init', '--bare', remote);
  await git(path, 'remote', 'add', 'origin', remote);
  const configPath = join(root, 'config.json');
  async function appFor(repositories: Record<string, unknown>) {
    await writeFile(configPath, JSON.stringify({ repositories }));
    const config = await loadRepositoryDeploymentConfig(configPath, {
      isolateInvalidRepositories: true,
    });
    const app = buildApp(
      { port: 3001, scanPaths: [root] },
      config.urls,
      config.hosting,
      config.environments,
      config.errors,
      config.gitPolicies,
    );
    t.after(() => app.close());
    const push = (branch: string) =>
      app.inject({
        method: 'POST',
        url: '/api/repositories/push',
        payload: { path, branch, skipChecks: true },
      });
    const branches = async () =>
      BranchesResponse.parse(
        (
          await app.inject(
            `/api/repositories/branches?path=${encodeURIComponent(path)}`,
          )
        ).json(),
      ).branches;
    return { app, config, push, branches };
  }
  return { root, path, remote, appFor };
}

test('list/detail and branch assessment share rules; a branch different from HEAD is blocked without executing hooks or tests', async (t) => {
  const { path, appFor } = await fixture(t);
  const { app, push, branches } = await appFor({
    [path]: {
      git: {
        policy: {
          default: rule('allowed'),
          branches: {
            main: rule('forbidden'),
            develop: rule('allowed', ['unit-tests']),
            'future/branch': rule('forbidden'),
          },
        },
        checks: {
          'unit-tests': {
            script: 'private-test-script',
            privateValue: 'do-not-expose',
          },
        },
      },
    },
  });
  const marker = join(path, 'hook-ran');
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    `#!/bin/sh\ntouch '${marker}'\nexit 0\n`,
    { mode: 0o755 },
  );
  const list = await app.inject('/api/repositories');
  const repository = ListRepositoriesResponse.parse(
    list.json(),
  ).repositories.find((repo) => repo.path === path);
  assert.ok(repository);
  const detail = Repository.parse(
    (
      await app.inject(
        `/api/repositories/detail?path=${encodeURIComponent(path)}`,
      )
    ).json(),
  );
  assert.deepEqual(detail.gitPolicy, repository.gitPolicy);
  assert.equal(detail.gitPolicy.state, 'configured');
  assert.equal(list.body.includes('private-test-script'), false);
  assert.equal(list.body.includes('do-not-expose'), false);
  const entries = await branches();
  assert.equal(entries.length, 3);
  assert.equal(
    entries.find((branch) => branch.name === 'main')?.pushAssessment.reasons[0]
      .code,
    'DIRECT_PUSH_FORBIDDEN',
  );
  assert.equal(
    entries.find((branch) => branch.name === 'develop')?.pushAssessment
      .reasons[0].code,
    'CHECK_RUNNER_UNAVAILABLE',
  );
  assert.equal(
    entries.find((branch) => branch.name === 'feature/login')?.pushAssessment
      .state,
    'ready',
  );
  for (const [branch, status, code] of [
    ['main', 403, 'DIRECT_PUSH_FORBIDDEN'],
    ['develop', 422, 'CHECK_RUNNER_UNAVAILABLE'],
  ] as const) {
    const response = await push(branch);
    assert.equal(response.statusCode, status);
    assert.equal(response.json().code, code);
    assert.equal(response.json().branch, branch);
  }
  assert.equal(await git(path, 'branch', '--show-current'), 'develop');
  await assert.rejects(access(marker));
});

test('allowed and unconfigured pushes preserve a real hook and explicit branch refspec', async (t) => {
  const { path, remote, appFor } = await fixture(t);
  const marker = join(path, 'hook-input');
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    `#!/bin/sh\ncat > '${marker}'\nexit 0\n`,
    { mode: 0o755 },
  );
  const { app, push } = await appFor({
    [path]: {
      git: {
        policy: {
          default: rule('allowed'),
          branches: { develop: rule('forbidden') },
        },
      },
    },
  });
  assert.equal((await push('main')).statusCode, 200);
  assert.equal(
    await git(remote, 'rev-parse', 'main'),
    await git(path, 'rev-parse', 'main'),
  );
  assert.match(
    await readFile(marker, 'utf8'),
    /^refs\/heads\/main [a-f0-9]+ refs\/heads\/main /,
  );
  await assert.rejects(
    git(remote, 'show-ref', '--verify', 'refs/heads/develop'),
  );
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    '#!/bin/sh\necho "private-hook-output" >&2\necho "husky - pre-push script failed (code 1)" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  const refused = await push('feature/login');
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.json().code, 'LOCAL_HOOK_FAILED');
  assert.equal(refused.body.includes('private-hook-output'), false);
  const { push: legacy, branches } = await appFor({});
  assert.equal((await branches())[0].pushAssessment.canAttempt, true);
  assert.equal((await branches())[0].pushAssessment.state, 'unknown');
  assert.equal((await legacy('main')).json().code, 'LOCAL_HOOK_FAILED');
  assert.equal((await push('main:develop')).statusCode, 400);
  assert.equal((await push('missing')).statusCode, 404);
  assert.equal(
    (
      await app.inject(
        `/api/repositories/branches?path=${encodeURIComponent(remote)}`,
      )
    ).statusCode,
    404,
  );
  // A repository can become unreadable after discovery; expose the policy
  // independently and refuse preflight without reporting a remote outage.
  await writeFile(join(path, '.git/HEAD'), 'invalid-head\n');
  const unavailable = await legacy('main');
  assert.equal(unavailable.statusCode, 422);
  assert.equal(unavailable.json().code, 'GIT_STATE_UNAVAILABLE');
  const detail = Repository.parse(
    (
      await app.inject(
        `/api/repositories/detail?path=${encodeURIComponent(path)}`,
      )
    ).json(),
  );
  assert.equal(detail.git, null);
  assert.equal(detail.gitPolicy.state, 'configured');
});

test('invalid/colliding policies fail closed independently of deployment quarantine and other repositories', async (t) => {
  const { path, appFor } = await fixture(t);
  for (const policy of [
    { default: rule('allowed', ['bad_id']) },
    { default: rule('allowed', ['same', 'same']) },
    { branches: { 'bad..branch': rule('allowed') } },
    { branches: { main: { directPush: 'allowed' } } },
    { branches: null },
    { default: { ...rule('allowed'), typo: true } },
  ]) {
    const policies = await parseRepositoryGitPolicies({
      [path]: { git: { policy } },
      '/other': { git: { policy: { default: rule('allowed') } } },
    });
    assert.equal(policies[path].state, 'invalid');
    assert.equal(policies['/other'].state, 'configured');
    RepositoryGitPolicy.parse(policies[path]);
  }
  const { config, push } = await appFor({
    [path]: {
      git: {
        policy: {
          default: rule('allowed'),
          branches: { main: rule('forbidden') },
        },
      },
      urls: { production: 'invalid-url' },
    },
  });
  assert.ok(config.errors?.[path]);
  assert.equal(config.gitPolicies?.[path].state, 'configured');
  assert.equal((await push('main')).statusCode, 403);
  const { push: bad, branches } = await appFor({
    [path]: {
      git: { policy: { default: rule('allowed', ['secret-invalid-id!']) } },
    },
  });
  const response = await bad('develop');
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, 'INVALID_PUSH_POLICY');
  assert.equal(response.body.includes('secret-invalid'), false);
  assert.deepEqual((await branches())[0].policy, {
    directPush: 'unknown',
    requiredChecks: null,
  });
  const collision = await parseRepositoryGitPolicies({
    [path]: { git: { policy: { default: rule('forbidden') } } },
    [`${path}/.`]: {},
  });
  assert.equal(collision[path].state, 'invalid');
  const magic = await parseRepositoryGitPolicies({
    [path]: {
      git: {
        policy: {
          branches: JSON.parse(
            '{"__proto__":{"directPush":"forbidden","requiredChecks":[]}}',
          ),
        },
      },
    },
  });
  assert.equal(
    assessBranchPush(magic[path], '__proto__').pushAssessment.canAttempt,
    false,
  );
});

test('contracts reject contradictions and invalid IDs; resolver follows decision priority', () => {
  const reason = (code: PushPolicyCode) => ({ code, message: 'Explanation.' });
  for (const value of [
    { state: 'ready', canAttempt: false, reasons: [] },
    {
      state: 'ready',
      canAttempt: true,
      reasons: [reason('POLICY_INCOMPLETE')],
    },
    { state: 'blocked', canAttempt: false, reasons: [] },
    {
      state: 'blocked',
      canAttempt: false,
      reasons: [reason('POLICY_UNCONFIGURED')],
    },
    {
      state: 'unknown',
      canAttempt: true,
      reasons: [reason('DIRECT_PUSH_FORBIDDEN')],
    },
    {
      state: 'unknown',
      canAttempt: false,
      reasons: [reason('POLICY_INCOMPLETE')],
    },
  ])
    assert.equal(PushAssessment.safeParse(value).success, false);
  assert.equal(
    RepositoryGitPolicy.safeParse({
      ...unconfiguredGitPolicy(),
      branches: { main: rule('allowed') },
    }).success,
    false,
  );
  assert.equal(
    RepositoryGitPolicy.safeParse({
      ...unconfiguredGitPolicy(),
      state: 'invalid',
    }).success,
    false,
  );
  assert.equal(GitCheckId.safeParse('a'.repeat(65)).success, false);
  assert.equal(
    GitBranchPolicy.safeParse(
      rule(
        'allowed',
        Array.from({ length: 65 }, (_, i) => `check-${i}`),
      ),
    ).success,
    false,
  );
  const policy = (branchRule: ReturnType<typeof rule>) =>
    RepositoryGitPolicy.parse({
      state: 'configured',
      source: 'local-config',
      remote: 'origin',
      default: branchRule,
      branches: {},
      error: null,
    });
  for (const [branchRule, available, code, canAttempt] of [
    [rule('forbidden', null), false, 'DIRECT_PUSH_FORBIDDEN', false],
    [rule('unknown', ['tests']), false, 'CHECK_RUNNER_UNAVAILABLE', false],
    [rule('allowed'), false, 'GIT_STATE_UNAVAILABLE', false],
    [rule('unknown', []), true, 'POLICY_INCOMPLETE', true],
    [rule('allowed', null), true, 'POLICY_INCOMPLETE', true],
    [rule('allowed'), true, undefined, true],
  ] as const) {
    const assessment = assessBranchPush(
      policy(branchRule),
      'main',
      available,
    ).pushAssessment;
    PushAssessment.parse(assessment);
    assert.equal(assessment.reasons[0]?.code, code);
    assert.equal(assessment.canAttempt, canAttempt);
  }
});
