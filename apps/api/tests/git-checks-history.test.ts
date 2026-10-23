import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  ChecksOperation,
  type ChecksOperation as Operation,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { GitChecksHistory } from '../src/services/git/git-checks-history.service.js';

const execute = promisify(execFile);
const date = () => new Date().toISOString();
function snapshot(
  path: string,
  status: Operation['status'] = 'succeeded',
): Operation {
  const active = ['queued', 'running'].includes(status);
  return ChecksOperation.parse({
    id: randomUUID(),
    path,
    branch: 'develop',
    commit: status === 'queued' ? null : 'a'.repeat(40),
    status,
    createdAt: date(),
    startedAt: status === 'queued' ? null : date(),
    completedAt: active ? null : date(),
    checks: [
      {
        checkId: 'test-run',
        required: true,
        status: active
          ? status === 'queued'
            ? 'pending'
            : 'running'
          : 'passed',
        commit: status === 'queued' ? null : 'a'.repeat(40),
        startedAt: status === 'queued' ? null : date(),
        completedAt: active ? null : date(),
      },
    ],
    push: null,
    error: null,
  });
}

test('completed checks survive API restart for scoped consultation without restoring push authority', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-history-api-'));
  const path = join(root, 'projects/project');
  const state = join(root, 'state');
  const log = join(root, 'executions');
  await mkdir(path, { recursive: true });
  await mkdir(join(path, '.pulsepit'));
  await writeFile(
    join(path, '.pulsepit/git-policy.json'),
    JSON.stringify({
      version: 1,
      remote: 'origin',
      branches: {
        develop: { directPush: 'allowed', requiredChecks: ['test-run'] },
      },
    }),
  );
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ scripts: { 'test:run': 'node checks.cjs' } }),
  );
  await writeFile(
    join(path, 'checks.cjs'),
    `require('node:fs').appendFileSync(${JSON.stringify(log)}, 'run\\n')`,
  );
  await execute('git', ['init', '--initial-branch=develop', path]);
  await execute('git', ['add', '.'], { cwd: path });
  await execute(
    'git',
    [
      '-c',
      'user.name=History Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--no-gpg-sign',
      '-m',
      'Initial',
    ],
    { cwd: path },
  );
  const config = {
    port: 3001,
    scanPaths: [join(root, 'projects')],
    configPath: join(state, 'config.json'),
  };
  const first = buildApp(config);
  first.log.level = 'silent';
  const second = buildApp(config);
  second.log.level = 'silent';
  t.after(async () => {
    await first.close();
    await second.close();
    await rm(root, { recursive: true, force: true });
  });
  const response = await first.inject({
    method: 'POST',
    url: '/api/repositories/checks',
    payload: { path, branch: 'develop' },
  });
  assert.equal(response.statusCode, 202);
  const id = response.json().id;
  let completed: Operation | undefined;
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = await first.inject({
      method: 'GET',
      url: `/api/repositories/checks/${id}?${new URLSearchParams({ path })}`,
    });
    completed = ChecksOperation.parse(result.json());
    if (completed.status === 'succeeded') break;
    await delay(15);
  }
  assert.equal(completed?.status, 'succeeded');
  await first.close();
  const historyFile = join(state, 'checks-history.json');
  const content = await readFile(historyFile, 'utf8');
  assert.equal((await lstat(historyFile)).mode & 0o777, 0o600);
  for (const internal of [
    'policyDigest',
    'privateKey',
    'signature',
    'evidence',
    'PULSEPIT_CHECKS',
  ])
    assert.equal(content.includes(internal), false);
  const restored = await second.inject({
    method: 'GET',
    url: `/api/repositories/checks/${id}?${new URLSearchParams({ path })}`,
  });
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(ChecksOperation.parse(restored.json()), completed);
  const branches = await second.inject({
    method: 'GET',
    url: `/api/repositories/branches?${new URLSearchParams({ path })}`,
  });
  const develop = branches
    .json()
    .branches.find((branch: { name: string }) => branch.name === 'develop');
  assert.equal(develop.checksId, null);
  assert.equal(develop.pushAssessment.canAttempt, false);
  const push = await second.inject({
    method: 'POST',
    url: '/api/repositories/push',
    payload: { path, branch: 'develop', checksId: id },
  });
  assert.equal(push.statusCode, 409);
  assert.equal(push.json().code, 'CHECK_CONTEXT_MISMATCH');
  assert.match(push.json().error, /previous API instance/);
  const wrong = await second.inject({
    method: 'GET',
    url: `/api/repositories/checks/${id}?${new URLSearchParams({ path: root })}`,
  });
  assert.equal(wrong.statusCode, 404);
  assert.equal(await readFile(log, 'utf8'), 'run\n');
});

test('restart terminates stale checks and marks interrupted push tracking as uncertain without launching anything', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-history-interrupted-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'project');
  await mkdir(join(path, '.git'), { recursive: true });
  const historyFile = join(root, 'checks-history.json');
  const queued = snapshot(path, 'queued');
  const running = snapshot(path, 'running');
  const pushing = snapshot(path);
  pushing.push = {
    status: 'running',
    startedAt: date(),
    completedAt: null,
    error: null,
  };
  await writeFile(
    historyFile,
    JSON.stringify({ version: 1, operations: [queued, running, pushing] }),
  );
  const app = buildApp({
    port: 3001,
    scanPaths: [root],
    configPath: join(root, 'config.json'),
  });
  app.log.level = 'silent';
  t.after(() => app.close());
  for (const entry of [queued, running, pushing]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/checks/${entry.id}?${new URLSearchParams({ path })}`,
    });
    assert.equal(response.statusCode, 200);
    const value = ChecksOperation.parse(response.json());
    if (entry !== pushing) {
      assert.equal(value.status, 'cancelled');
      assert.equal(value.error?.code, 'CHECKS_INTERRUPTED');
      assert.equal(value.checks[0].status, 'cancelled');
    } else {
      assert.equal(value.status, 'succeeded');
      assert.equal(value.push?.status, 'failed');
      assert.equal(value.push?.error?.code, 'PUSH_INTERRUPTED');
      assert.match(value.push?.error?.message ?? '', /Verify the remote state/);
    }
  }
  const persisted = JSON.parse(await readFile(historyFile, 'utf8'));
  for (const operation of persisted.operations)
    ChecksOperation.parse(operation);
  assert.equal(
    persisted.operations.some(
      (entry: Operation) =>
        entry.status === 'running' || entry.push?.status === 'running',
    ),
    false,
  );
});

test('history validates bounded snapshots, expires records, serializes writes and preserves symlink targets on failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-history-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'history.json');
  let errors = 0;
  const history = new GitChecksHistory(file, () => {
    errors++;
  });
  const old = snapshot(root);
  old.completedAt = new Date(Date.now() - 16 * 60_000).toISOString();
  const recent = snapshot(root);
  await history.save([old, recent]);
  assert.deepEqual(await history.load(), [recent]);
  const next = snapshot(root);
  await Promise.all([history.save([recent]), history.save([recent, next])]);
  assert.deepEqual(await history.load(), [recent, next]);
  for (const body of [
    'private invalid content',
    JSON.stringify({ version: 2, operations: [recent] }),
    JSON.stringify({ version: 1, operations: [recent, recent] }),
    'x'.repeat(4 * 1024 * 1024 + 1),
  ]) {
    await writeFile(file, body);
    assert.deepEqual(await history.load(), []);
  }
  assert.equal(errors, 4);
  await rm(file);
  const target = join(root, 'private');
  await writeFile(target, 'untouched-private-content');
  await symlink(target, file);
  assert.deepEqual(await history.load(), []);
  await history.save([recent]);
  assert.equal(errors, 6);
  assert.equal(await readFile(target, 'utf8'), 'untouched-private-content');
  assert.equal((await lstat(file)).isSymbolicLink(), true);
});
