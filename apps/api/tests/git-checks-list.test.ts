import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ChecksOperation, ListChecksResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);
function operation(path: string, createdAt: string): ChecksOperation {
  return ChecksOperation.parse({
    id: randomUUID(),
    path,
    branch: 'develop',
    commit: 'a'.repeat(40),
    status: 'succeeded',
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    checks: [
      {
        checkId: 'test-run',
        required: true,
        status: 'passed',
        commit: 'a'.repeat(40),
        startedAt: createdAt,
        completedAt: createdAt,
      },
    ],
    push: null,
    error: null,
  });
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-checks-list-'));
  const scan = join(root, 'projects');
  const path = join(scan, 'project');
  const neighbour = join(scan, 'neighbour');
  const empty = join(scan, 'empty');
  for (const repo of [path, neighbour, empty])
    await mkdir(join(repo, '.git'), { recursive: true });
  const config = {
    port: 3001,
    scanPaths: [scan],
    configPath: join(root, 'config.json'),
  };
  const app = buildApp(config);
  app.log.level = 'silent';
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const seed = async (operations: ChecksOperation[]) =>
    writeFile(
      join(root, 'checks-history.json'),
      JSON.stringify({ version: 1, operations }),
    );
  const list = (queryPath = path) =>
    app.inject({
      method: 'GET',
      url: `/api/repositories/checks?${new URLSearchParams({ path: queryPath })}`,
    });
  return { root, path, neighbour, empty, app, seed, list };
}

test('lists all 100 retained operations after restart in deterministic newest-first order without evicting on reads', async (t) => {
  const { path, app, seed, list } = await fixture(t);
  const base = Date.now() - 100_000;
  const operations = Array.from({ length: 100 }, (_, index) =>
    operation(
      path,
      new Date(base + Math.floor(index / 2) * 1000).toISOString(),
    ),
  );
  await seed([...operations].reverse());
  const expected = [...operations].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  for (let read = 0; read < 2; read++) {
    const response = await list(`${path}/.`);
    assert.equal(response.statusCode, 200);
    const parsed = ListChecksResponse.parse(response.json());
    assert.equal(parsed.path, path);
    assert.deepEqual(parsed.operations, expected);
    assert.equal(parsed.operations.length, 100);
    assert.equal(JSON.stringify(parsed).includes('evidence'), false);
  }
  const detail = await app.inject({
    method: 'GET',
    url: `/api/repositories/checks/${operations[0].id}?${new URLSearchParams({ path })}`,
  });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(ChecksOperation.parse(detail.json()), operations[0]);
  assert.equal(
    ListChecksResponse.safeParse({
      path,
      operations: [...operations, operations[0]],
    }).success,
    false,
  );
});

test('lists only the discovered repository, expires old results and distinguishes empty lists from invalid requests', async (t) => {
  const { root, path, neighbour, empty, app, seed, list } = await fixture(t);
  const recent = operation(path, new Date().toISOString());
  const foreign = operation(neighbour, new Date().toISOString());
  const expired = operation(
    path,
    new Date(Date.now() - 16 * 60_000).toISOString(),
  );
  await seed([expired, recent, foreign]);
  assert.deepEqual(ListChecksResponse.parse((await list()).json()), {
    path,
    operations: [recent],
  });
  assert.deepEqual(ListChecksResponse.parse((await list(neighbour)).json()), {
    path: neighbour,
    operations: [foreign],
  });
  assert.deepEqual(ListChecksResponse.parse((await list(empty)).json()), {
    path: empty,
    operations: [],
  });
  for (const denied of [root, join(root, 'outside'), join(path, 'missing')])
    assert.equal((await list(denied)).statusCode, 404);
  for (const url of [
    '/api/repositories/checks',
    '/api/repositories/checks?path=',
    '/api/repositories/checks?path=%20',
  ])
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 400);
  assert.equal(
    ListChecksResponse.safeParse({ path, operations: [foreign] }).success,
    false,
  );
});

test('lists a newly started operation, tracks cancellation and reserves space only when adding the 101st result', async (t) => {
  const { path, app, seed, list } = await fixture(t);
  await execute('git', ['init', '--initial-branch=develop', path]);
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
  await writeFile(join(path, 'checks.cjs'), 'setTimeout(() => {}, 10000)');
  await execute('git', ['add', '.'], { cwd: path });
  await execute(
    'git',
    [
      '-c',
      'user.name=Checks Test',
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
  const old = Array.from({ length: 100 }, (_, index) =>
    operation(
      path,
      new Date(Date.now() - 120_000 + index * 1000).toISOString(),
    ),
  );
  await seed(old);
  const started = await app.inject({
    method: 'POST',
    url: '/api/repositories/checks',
    payload: { path, branch: 'develop' },
  });
  assert.equal(started.statusCode, 202);
  const id = started.json().id;
  const active = ListChecksResponse.parse((await list()).json());
  assert.equal(active.operations.length, 100);
  assert.equal(active.operations[0].id, id);
  assert.ok(['queued', 'running'].includes(active.operations[0].status));
  assert.equal(
    active.operations.some((entry) => entry.id === old[0].id),
    false,
  );
  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/repositories/checks/${id}/cancel?${new URLSearchParams({ path })}`,
  });
  assert.equal(cancelled.statusCode, 200);
  const after = ListChecksResponse.parse((await list()).json());
  assert.equal(after.operations[0].id, id);
  assert.equal(after.operations[0].status, 'cancelled');
  assert.equal(after.operations[0].error?.code, 'CHECKS_CANCELLED');
});
