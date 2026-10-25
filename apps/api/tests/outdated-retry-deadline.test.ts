import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { ErrorResponse, OutdatedResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-retry-deadline-'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const script = join(bin, 'manager.cjs');
  await writeFile(
    script,
    `const fs=require('node:fs');
fs.appendFileSync('calls','call\\n');
const fixture=JSON.parse(fs.readFileSync('fixture.json','utf8'));
setTimeout(()=>{fs.writeSync(1,JSON.stringify(fixture.output));process.exitCode=fixture.exitCode;},50);
`,
  );
  for (const manager of ['npm', 'pnpm'])
    await writeFile(
      join(bin, manager),
      `#!/bin/sh\nunset NODE_TEST_CONTEXT\nexec "${process.execPath}" "${script}" "$@"\n`,
      { mode: 0o755 },
    );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  const config = { port: 3001, scanPaths: [root] };
  const app = buildApp(config);
  app.log.level = 'silent';
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function project(name: string) {
    const path = join(root, name);
    await mkdir(join(path, '.git'), { recursive: true });
    await writeFile(
      join(path, 'package.json'),
      '{"packageManager":"npm@10.0.0"}',
    );
    return path;
  }
  async function output(path: string, value: unknown, exitCode = 1) {
    await writeFile(
      join(path, 'fixture.json'),
      JSON.stringify({ output: value, exitCode }),
    );
  }
  const diagnose = (path: string, instance = app) =>
    instance.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path },
    });
  const calls = async (path: string) =>
    (await readFile(join(path, 'calls'), 'utf8')).trim().split('\n').length;
  return { app, config, project, output, diagnose, calls };
}
const limited = (retryAfter?: string) => ({
  error: {
    code: 'E429',
    summary: 'https://private.invalid/?token=secret',
    ...(retryAfter === undefined
      ? {}
      : { headers: { 'retry-after': retryAfter } }),
  },
});

test('a reliable deadline blocks repeated calls without sliding, then permits a manual retry at expiry', async (t) => {
  const f = await fixture(t);
  let now = Date.parse('2026-10-25T12:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  const path = await f.project('one');
  await f.output(path, limited('60'));
  const first = await f.diagnose(path);
  assert.equal(first.statusCode, 502);
  const error = ErrorResponse.parse(first.json());
  assert.equal(error.code, 'REGISTRY_RATE_LIMITED');
  assert.equal(error.resetAt, '2026-10-25T12:01:00.000Z');
  assert.equal(first.body.includes('private.invalid'), false);
  assert.equal(first.body.includes('secret'), false);
  // Changing managers and using an equivalent normalized path cannot bypass the deadline.
  await writeFile(
    join(path, 'package.json'),
    '{"packageManager":"pnpm@10.0.0"}',
  );
  await f.output(path, {}, 0);
  now += 59_999;
  const blocked = await f.diagnose(`${path}/../one`);
  assert.equal(blocked.statusCode, 502);
  assert.deepEqual(blocked.json(), first.json());
  assert.equal(await f.calls(path), 1);
  now += 1;
  const success = await f.diagnose(path);
  assert.equal(success.statusCode, 200);
  assert.equal(OutdatedResponse.parse(success.json()).packageManager, 'pnpm');
  assert.equal(await f.calls(path), 2);
  // A success is not cached and does not retain the old deadline.
  assert.equal((await f.diagnose(path)).statusCode, 200);
  assert.equal(await f.calls(path), 3);
});

test('deadlines are isolated by repository and API instance and do not skip repository validation', async (t) => {
  const f = await fixture(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-10-25T12:00:00.000Z'));
  const one = await f.project('one');
  const two = await f.project('two');
  await f.output(one, limited('60'));
  assert.equal((await f.diagnose(one)).statusCode, 502);
  await f.output(two, {}, 0);
  assert.equal((await f.diagnose(two)).statusCode, 200);
  assert.equal(await f.calls(two), 1);
  const fresh = buildApp(f.config);
  fresh.log.level = 'silent';
  t.after(() => fresh.close());
  await f.output(one, {}, 0);
  assert.equal((await f.diagnose(one, fresh)).statusCode, 200);
  assert.equal(await f.calls(one), 2);
  assert.equal((await f.diagnose(one)).statusCode, 502);
  assert.equal(await f.calls(one), 2);
  await rm(join(one, '.git'), { recursive: true });
  assert.equal((await f.diagnose(one)).statusCode, 404);
});

test('concurrent calls share one execution; absent, invalid or reached deadlines and other errors allow manual retries', async (t) => {
  const f = await fixture(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-10-25T12:00:00.000Z'));
  const path = await f.project('one');
  await f.output(path, limited('60'));
  const responses = await Promise.all([
    f.diagnose(path),
    f.diagnose(path),
    f.diagnose(path),
  ]);
  assert.equal(await f.calls(path), 1);
  for (const response of responses) {
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), responses[0].json());
  }
  const other = await f.project('other');
  for (const value of [
    limited(),
    limited('invalid'),
    limited('0'),
    { error: { code: 'E401', headers: { 'retry-after': '60' } } },
  ]) {
    await f.output(other, value);
    const error = await f.diagnose(other);
    assert.equal(error.statusCode, 502);
    const body = ErrorResponse.parse(error.json());
    assert.equal(
      body.code,
      'error' in value && value.error.code === 'E401'
        ? 'REGISTRY_AUTHENTICATION_FAILED'
        : 'REGISTRY_RATE_LIMITED',
    );
    await f.output(other, {}, 0);
    assert.equal((await f.diagnose(other)).statusCode, 200);
  }
  assert.equal(await f.calls(other), 8);
});
