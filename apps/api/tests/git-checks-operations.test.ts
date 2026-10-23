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
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { ChecksOperation } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import {
  ChecksRequestError,
  GitChecksService,
} from '../src/services/git/git-checks.service.js';

const execute = promisify(execFile);
async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-checks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'project');
  const flags = join(root, 'flags.json');
  const log = join(root, 'events');
  const marker = join(root, 'orphan');
  await execute('git', ['init', '--initial-branch=develop', path]);
  await mkdir(join(path, '.pulsepit'));
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
  await writeFile(join(path, 'app.txt'), 'Original\n');
  await writeFile(flags, '{}');
  await writeFile(
    join(path, 'checks.mjs'),
    `import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';\nconst flags=JSON.parse(readFileSync(${JSON.stringify(flags)},'utf8')); const step=process.argv[2];\nappendFileSync(${JSON.stringify(log)},JSON.stringify({step,secret:!!process.env.VERCEL_TOKEN||!!process.env.GITHUB_TOKEN})+'\\n');\nconsole.log('private-script-output-do-not-expose');\nif(flags.change&&step==='lint')writeFileSync('app.txt','Modified\\n');\nif(flags.fail&&step==='tests')process.exit(1);\nif(flags.slow&&step==='tests'){setTimeout(()=>writeFileSync(${JSON.stringify(marker)},'orphan'),800);setTimeout(()=>{},5000);}\n`,
  );
  await git(path, 'add', '.');
  await git(
    path,
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
  );
  await git(path, 'branch', 'main');
  await git(path, 'branch', 'feature/example');
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    `#!/bin/sh\ntouch '${join(root, 'push-ran')}'\nexit 1\n`,
    { mode: 0o755 },
  );
  const app = buildApp({ port: 3001, scanPaths: [root] });
  app.log.level = 'silent';
  t.after(() => app.close());
  return { root, path, flags, log, marker, app };
}
async function waitFor<T>(
  read: () => Promise<T> | T,
  ready: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 7000;
  while (true) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error('Operation did not complete.');
    await delay(20);
  }
}
const done = (value: ChecksOperation) =>
  !['queued', 'running'].includes(value.status);

test('HTTP check operation progresses to success with commit evidence, sanitized results and no hook or push', async (t) => {
  const { root, path, app, log } = await fixture(t);
  const previous = process.env.VERCEL_TOKEN;
  process.env.VERCEL_TOKEN = 'private-token';
  t.after(() => {
    if (previous === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = previous;
  });
  const start = await app.inject({
    method: 'POST',
    url: '/api/repositories/checks',
    payload: { path, branch: 'develop' },
  });
  assert.equal(start.statusCode, 202);
  const initial = ChecksOperation.parse(start.json());
  assert.equal(initial.status, 'queued');
  const url = String(start.headers.location);
  const result = await waitFor(
    async () => ChecksOperation.parse((await app.inject(url)).json()),
    done,
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.commit, await git(path, 'rev-parse', 'develop'));
  assert.ok(
    result.checks.every(
      (check) =>
        check.status === 'passed' &&
        check.commit === result.commit &&
        check.completedAt,
    ),
  );
  assert.equal(JSON.stringify(result).includes('private-script'), false);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
  const events = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((value) => value.step),
    ['lint', 'tests'],
  );
  assert.ok(events.every((value) => value.secret === false));
  await assert.rejects(access(join(root, 'push-ran')));
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/repositories/checks',
        payload: { path, branch: 'main' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/repositories/checks',
        payload: { path, branch: 'HEAD' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/repositories/checks',
        payload: { path, branch: 'develop', command: 'arbitrary' },
      })
    ).statusCode,
    400,
  );
});

test('required failures and changed or mismatched contexts never produce a successful operation', async (t) => {
  const { path, flags, log } = await fixture(t);
  const runner = new GitChecksService();
  t.after(() => runner.close());
  await writeFile(flags, JSON.stringify({ fail: true }));
  let operation = await runner.start(path, 'develop');
  let result = await waitFor(
    () => ChecksOperation.parse(runner.get(operation.id, path)),
    done,
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'CHECK_FAILED');
  assert.equal(
    result.checks.find((check) => check.checkId === 'test-run')?.status,
    'failed',
  );
  await writeFile(flags, JSON.stringify({ change: true }));
  await rm(log);
  operation = await runner.start(path, 'develop');
  result = await waitFor(
    () => ChecksOperation.parse(runner.get(operation.id, path)),
    done,
  );
  assert.equal(result.error?.code, 'CHECK_CONTEXT_MISMATCH');
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
  await git(path, 'restore', 'app.txt');
  await git(path, 'checkout', 'feature/example');
  await rm(log);
  operation = await runner.start(path, 'develop');
  result = await waitFor(
    () => ChecksOperation.parse(runner.get(operation.id, path)),
    done,
  );
  assert.equal(result.error?.code, 'CHECK_CONTEXT_MISMATCH');
  await assert.rejects(access(log));
});

test('repository lock, cancellation, shutdown and timeout terminate the complete check process group', async (t) => {
  const { path, flags, log, marker } = await fixture(t);
  await writeFile(flags, JSON.stringify({ slow: true }));
  const runner = new GitChecksService();
  t.after(() => runner.close());
  const job = await runner.start(path, 'develop');
  await assert.rejects(
    runner.start(path, 'develop'),
    (error) =>
      error instanceof ChecksRequestError && error.code === 'CHECKS_BUSY',
  );
  await waitFor(
    async () => {
      try {
        return await readFile(log, 'utf8');
      } catch {
        return '';
      }
    },
    (value) => value.includes('tests'),
  );
  const cancelled = ChecksOperation.parse(runner.cancel(job.id, path));
  assert.equal(cancelled.status, 'cancelled');
  await runner.close();
  await delay(900);
  await assert.rejects(access(marker));
  await rm(log);
  const timed = new GitChecksService({}, { timeoutMs: 500 });
  t.after(() => timed.close());
  const next = await timed.start(path, 'develop');
  const result = await waitFor(
    () => ChecksOperation.parse(timed.get(next.id, path)),
    done,
  );
  assert.equal(result.status, 'timed_out');
  assert.equal(result.error?.code, 'CHECKS_TIMEOUT');
  await timed.close();
  await delay(900);
  await assert.rejects(access(marker));
});

test('operation lookup and cancellation are scoped to discovered repositories and contracts reject false success', async (t) => {
  const { root, path, app } = await fixture(t);
  const start = await app.inject({
    method: 'POST',
    url: '/api/repositories/checks',
    payload: { path, branch: 'develop' },
  });
  const job = ChecksOperation.parse(start.json());
  const other = join(root, 'other');
  await execute('git', ['init', other]);
  for (const suffix of ['', '/cancel']) {
    const response = await app.inject({
      method: suffix ? 'POST' : 'GET',
      url: `/api/repositories/checks/${job.id}${suffix}?${new URLSearchParams({ path: other })}`,
    });
    assert.equal(response.statusCode, 404);
  }
  assert.equal(
    (await app.inject(`/api/repositories/checks/${job.id}?path=%2Foutside`))
      .statusCode,
    404,
  );
  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/repositories/checks/${job.id}/cancel?${new URLSearchParams({ path })}`,
  });
  ChecksOperation.parse(cancelled.json());
  assert.equal(
    ChecksOperation.safeParse({
      ...job,
      status: 'succeeded',
      completedAt: new Date().toISOString(),
    }).success,
    false,
  );
  assert.equal(
    ChecksOperation.safeParse({
      ...job,
      status: 'running',
      completedAt: new Date().toISOString(),
    }).success,
    false,
  );
});
