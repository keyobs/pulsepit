import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  BranchesResponse,
  ChecksOperation,
  PushResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);
const canonical = fileURLToPath(
  new URL('../../../scripts/hooks/pulsepit-pre-push.mjs', import.meta.url),
);
const wrapper = '#!/bin/sh\nexec node .husky/pulsepit-pre-push.mjs "$@"\n';
async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-checked-push-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'project');
  const remote = join(root, 'remote.git');
  const log = join(root, 'checks.log');
  await execute('git', ['init', '--initial-branch=develop', path]);
  await mkdir(join(path, '.pulsepit'));
  await mkdir(join(path, '.husky'));
  await copyFile(canonical, join(path, '.husky/pulsepit-pre-push.mjs'));
  await writeFile(join(path, '.git/hooks/pre-push'), wrapper, { mode: 0o755 });
  await writeFile(
    join(path, '.pulsepit/git-policy.json'),
    JSON.stringify({
      version: 1,
      remote: 'origin',
      branches: {
        main: { directPush: 'forbidden', requiredChecks: [] },
        develop: {
          directPush: 'allowed',
          requiredChecks: ['lint-fix', 'test-run'],
        },
      },
    }),
  );
  await writeFile(join(path, 'app.txt'), 'Original\n');
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: {
        'lint:fix': 'node checks.mjs lint',
        'test:run': 'node checks.mjs tests',
      },
    }),
  );
  await writeFile(
    join(path, 'checks.mjs'),
    `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(log)},process.argv[2]+'\\n');`,
  );
  await git(path, 'add', '.');
  await git(
    path,
    '-c',
    'user.name=Checked Push Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  await git(path, 'branch', 'main');
  await git(path, 'branch', 'feature/example');
  await git(root, 'init', '--bare', remote);
  await git(path, 'remote', 'add', 'origin', remote);
  const app = buildApp({ port: 3001, scanPaths: [root] });
  app.log.level = 'silent';
  t.after(() => app.close());
  const branchUrl = `/api/repositories/branches?${new URLSearchParams({ path })}`;
  const operationUrl = (id: string) =>
    `/api/repositories/checks/${id}?${new URLSearchParams({ path })}`;
  const push = (checksId?: string, branch = 'develop') =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/push',
      payload: { path, branch, ...(checksId ? { checksId } : {}) },
    });
  async function check() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/checks',
      payload: { path, branch: 'develop' },
    });
    assert.equal(response.statusCode, 202);
    const initial = ChecksOperation.parse(response.json());
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const operation = ChecksOperation.parse(
        (await app.inject(operationUrl(initial.id))).json(),
      );
      if (!['queued', 'running'].includes(operation.status)) {
        assert.equal(operation.status, 'succeeded');
        return operation;
      }
      await delay(20);
    }
    throw new Error('Checks did not complete.');
  }
  return { root, path, remote, log, app, branchUrl, operationUrl, push, check };
}

test('successful checks enable a single pinned push without executing the tests twice; the operation tracks push success', async (t) => {
  const { path, remote, log, app, branchUrl, operationUrl, push, check } =
    await fixture(t);
  const operation = await check();
  const entries = BranchesResponse.parse(
    (await app.inject(branchUrl)).json(),
  ).branches;
  const branch = entries.find((item) => item.name === 'develop');
  assert.equal(branch?.checksId, operation.id);
  assert.equal(branch?.pushAssessment.canAttempt, true);
  const response = await push();
  assert.equal(response.statusCode, 200);
  PushResponse.parse(response.json());
  assert.equal(await git(remote, 'rev-parse', 'develop'), operation.commit);
  assert.equal(await readFile(log, 'utf8'), 'lint\ntests\n');
  let result = ChecksOperation.parse(
    (await app.inject(operationUrl(operation.id))).json(),
  );
  assert.equal(result.push?.status, 'succeeded');
  assert.equal((await push(operation.id)).statusCode, 409);
  result = ChecksOperation.parse(
    (await app.inject(operationUrl(operation.id))).json(),
  );
  assert.equal(result.push?.status, 'succeeded');
  assert.equal((await push(operation.id, 'main')).statusCode, 404);
  assert.equal(await git(path, 'branch', '--show-current'), 'develop');
});

test('changed worktree, checkout, policy or commit makes evidence unusable before any push', async (t) => {
  const { path, remote, log, app, branchUrl, push, check } = await fixture(t);
  const operation = await check();
  await writeFile(join(path, 'app.txt'), 'Modified\n');
  assert.equal(
    BranchesResponse.parse((await app.inject(branchUrl)).json()).branches.find(
      (item) => item.name === 'develop',
    )?.pushAssessment.canAttempt,
    false,
  );
  assert.equal((await push(operation.id)).statusCode, 409);
  await git(path, 'restore', 'app.txt');
  await git(path, 'checkout', 'feature/example');
  assert.equal((await push(operation.id)).statusCode, 409);
  await git(path, 'checkout', 'develop');
  const policyPath = join(path, '.pulsepit/git-policy.json');
  await writeFile(policyPath, `${await readFile(policyPath, 'utf8')}\n`);
  assert.equal((await push(operation.id)).statusCode, 409);
  await git(path, 'restore', '.pulsepit/git-policy.json');
  await git(
    path,
    '-c',
    'user.name=Checked Push Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Advance',
  );
  assert.equal((await push(operation.id)).statusCode, 409);
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)'), '');
  assert.equal(await readFile(log, 'utf8'), 'lint\ntests\n');
});

test('custom or outdated hooks are preserved and never bypassed to consume check evidence', async (t) => {
  const { path, remote, log, push, check } = await fixture(t);
  const operation = await check();
  const custom = wrapper.replace(
    'exec node',
    'echo custom-hook >&2\nexec node',
  );
  await writeFile(join(path, '.git/hooks/pre-push'), custom, { mode: 0o755 });
  assert.equal((await push(operation.id)).statusCode, 409);
  assert.equal(
    await readFile(join(path, '.git/hooks/pre-push'), 'utf8'),
    custom,
  );
  await writeFile(join(path, '.git/hooks/pre-push'), wrapper, { mode: 0o755 });
  await writeFile(
    join(path, '.husky/pulsepit-pre-push.mjs'),
    '// unsupported helper\n',
  );
  assert.equal((await push(operation.id)).statusCode, 409);
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)'), '');
  assert.equal(await readFile(log, 'utf8'), 'lint\ntests\n');
});

test('a forged signature is rejected by the real hook before checks and updates; push errors remain sanitized', async (t) => {
  const { root, path, remote, log, app, push } = await fixture(t);
  const proofPath = join(root, 'forged.json');
  await writeFile(
    proofPath,
    JSON.stringify({
      body: '{"private":"do-not-expose"}',
      signature: Buffer.alloc(64).toString('base64'),
    }),
    { mode: 0o600 },
  );
  const { publicKey } = generateKeyPairSync('ed25519');
  await assert.rejects(
    execute(
      'git',
      [
        'push',
        '--porcelain',
        'origin',
        'refs/heads/develop:refs/heads/develop',
      ],
      {
        cwd: path,
        env: {
          ...process.env,
          PULSEPIT_CHECKS_PROOF: proofPath,
          PULSEPIT_CHECKS_PUBLIC_KEY: publicKey
            .export({ type: 'spki', format: 'der' })
            .toString('base64'),
        },
      },
    ),
    (error) => {
      assert.equal(String(error).includes('do-not-expose'), false);
      return true;
    },
  );
  await assert.rejects(readFile(log));
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)'), '');
  assert.equal(
    (await push('00000000-0000-4000-8000-000000000000')).statusCode,
    404,
  );
  const response = await app.inject({
    method: 'POST',
    url: '/api/repositories/push',
    payload: { path, branch: 'main', checksId: 'not-a-uuid' },
  });
  assert.equal(response.statusCode, 400);
});
