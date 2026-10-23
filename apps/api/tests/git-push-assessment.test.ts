import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  BranchesResponse,
  ChecksOperation,
  type LocalBranch,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { checksAdapterPath } from '../src/services/git/git-checks-proof.service.js';

const execute = promisify(execFile);
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-assessment-'));
  const path = join(root, 'project');
  const flags = join(root, 'flags');
  const log = join(root, 'runs');
  await execute('git', ['init', '--initial-branch=develop', path]);
  for (const directory of ['.pulsepit', '.husky'])
    await mkdir(join(path, directory));
  const policyPath = join(path, '.pulsepit/git-policy.json');
  const declaration = {
    version: 1,
    remote: 'origin',
    branches: {
      main: { directPush: 'forbidden', requiredChecks: [] },
      develop: { directPush: 'allowed', requiredChecks: ['test-run'] },
    },
  };
  await writeFile(policyPath, JSON.stringify(declaration));
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ scripts: { 'test:run': 'node checks.cjs' } }),
  );
  await writeFile(flags, 'pass');
  await writeFile(
    join(path, 'checks.cjs'),
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)}, 'run\\n');const flag=fs.readFileSync(${JSON.stringify(flags)},'utf8');if(flag==='fail')process.exit(1);if(flag==='slow')setTimeout(()=>{},10000);`,
  );
  await copyFile(checksAdapterPath, join(path, '.husky/pulsepit-pre-push.mjs'));
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    '#!/bin/sh\nexec node .husky/pulsepit-pre-push.mjs "$@"\n',
    { mode: 0o755 },
  );
  const git = async (...args: string[]) => execute('git', args, { cwd: path });
  await git('add', '.');
  await git(
    '-c',
    'user.name=Assessment Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  await git('branch', 'main');
  const config = {
    port: 3001,
    scanPaths: [root],
    configPath: join(root, 'state/config.json'),
  };
  const app = buildApp(config);
  app.log.level = 'silent';
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const branches = async (target = app) => {
    const response = await target.inject({
      method: 'GET',
      url: `/api/repositories/branches?${new URLSearchParams({ path })}`,
    });
    assert.equal(response.statusCode, 200);
    return BranchesResponse.parse(response.json()).branches;
  };
  const assessment = async () => {
    const branch = (await branches()).find(
      (branch) => branch.name === 'develop',
    );
    assert.ok(branch);
    return branch;
  };
  const push = (extra: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/push',
      payload: { path, branch: 'develop', ...extra },
    });
  const start = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/checks',
      payload: { path, branch: 'develop' },
    });
    assert.equal(response.statusCode, 202);
    return ChecksOperation.parse(response.json());
  };
  const finish = async (id: string) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/repositories/checks/${id}?${new URLSearchParams({ path })}`,
      });
      const value = ChecksOperation.parse(response.json());
      if (!['queued', 'running'].includes(value.status)) return value;
      await delay(15);
    }
    throw new Error('Check operation did not finish.');
  };
  return {
    root,
    path,
    flags,
    log,
    policyPath,
    declaration,
    config,
    app,
    git,
    branches,
    assessment,
    push,
    start,
    finish,
  };
}
function reason(branch: LocalBranch | undefined) {
  assert.ok(branch);
  return branch.pushAssessment.reasons[0]?.code;
}

test('distinguishes checks to run from unsupported adapters and preserves direct-push prohibitions', async (t) => {
  const f = await fixture(t);
  assert.equal(reason(await f.assessment()), 'CHECKS_REQUIRED');
  const refused = await f.push();
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, 'CHECKS_REQUIRED');
  assert.equal(
    reason((await f.branches()).find((branch) => branch.name === 'main')),
    'DIRECT_PUSH_FORBIDDEN',
  );
  const protectedPush = await f.push({ branch: 'main' });
  assert.equal(protectedPush.statusCode, 403);
  await writeFile(join(f.path, '.git/hooks/pre-push'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  assert.equal(reason(await f.assessment()), 'CHECK_RUNNER_UNAVAILABLE');
  assert.equal((await f.push()).statusCode, 422);
  await writeFile(
    f.policyPath,
    JSON.stringify({
      ...f.declaration,
      branches: {
        develop: { directPush: 'allowed', requiredChecks: ['custom'] },
      },
    }),
  );
  assert.equal(reason(await f.assessment()), 'CHECK_RUNNER_UNAVAILABLE');
});

test('distinguishes ready, expired, changed and consumed results without rerunning scripts or pushing', async (t) => {
  const f = await fixture(t);
  const operation = await f.finish((await f.start()).id);
  assert.equal(operation.status, 'succeeded');
  const ready = await f.assessment();
  assert.equal(ready.pushAssessment.state, 'ready');
  assert.equal(ready.checksId, operation.id);
  const actualNow = Date.now();
  const clock = t.mock.method(Date, 'now', () => actualNow + 6 * 60_000);
  try {
    assert.equal(reason(await f.assessment()), 'CHECKS_EXPIRED');
    assert.equal((await f.push()).json().code, 'CHECKS_EXPIRED');
  } finally {
    clock.mock.restore();
  }
  await writeFile(join(f.path, 'dirty'), 'change');
  assert.equal(reason(await f.assessment()), 'CHECK_CONTEXT_MISMATCH');
  assert.equal((await f.push()).json().code, 'CHECK_CONTEXT_MISMATCH');
  await rm(join(f.path, 'dirty'));
  const original = await readFile(f.policyPath, 'utf8');
  await writeFile(f.policyPath, `${original}\n`);
  assert.equal(reason(await f.assessment()), 'CHECK_CONTEXT_MISMATCH');
  await writeFile(f.policyPath, original);
  const attempted = await f.push({ checksId: operation.id });
  assert.equal(attempted.json().code, 'REMOTE_NOT_FOUND');
  assert.equal(reason(await f.assessment()), 'CHECKS_CONSUMED');
  assert.equal((await f.push()).json().code, 'CHECKS_CONSUMED');
  assert.equal(await readFile(f.log, 'utf8'), 'run\n');
});

test('uses the latest failure, reports active checks and cancellation, and rejects restored successes after restart', async (t) => {
  const f = await fixture(t);
  const old = await f.finish((await f.start()).id);
  assert.equal(old.status, 'succeeded');
  await writeFile(f.flags, 'fail');
  assert.equal((await f.finish((await f.start()).id)).status, 'failed');
  assert.equal(reason(await f.assessment()), 'CHECK_FAILED');
  assert.equal((await f.push()).json().code, 'CHECK_FAILED');
  const obsolete = await f.push({ checksId: old.id });
  assert.equal(obsolete.statusCode, 409);
  assert.equal(obsolete.json().code, 'CHECK_CONTEXT_MISMATCH');
  await writeFile(f.flags, 'slow');
  const active = await f.start();
  assert.equal(reason(await f.assessment()), 'CHECKS_RUNNING');
  assert.equal((await f.push()).json().code, 'CHECKS_RUNNING');
  const cancelled = await f.app.inject({
    method: 'POST',
    url: `/api/repositories/checks/${active.id}/cancel?${new URLSearchParams({ path: f.path })}`,
  });
  assert.equal(cancelled.statusCode, 200);
  const deadline = Date.now() + 3000;
  while (
    reason(await f.assessment()) === 'CHECKS_RUNNING' &&
    Date.now() < deadline
  )
    await delay(15);
  assert.equal(reason(await f.assessment()), 'CHECKS_REQUIRED');
  await writeFile(f.flags, 'pass');
  assert.equal((await f.finish((await f.start()).id)).status, 'succeeded');
  await f.app.close();
  const restarted = buildApp(f.config);
  restarted.log.level = 'silent';
  t.after(() => restarted.close());
  const restored = (await f.branches(restarted)).find(
    (branch) => branch.name === 'develop',
  );
  assert.ok(restored);
  assert.equal(reason(restored), 'CHECKS_RESTARTED');
  assert.equal(restored.checksId, null);
});
