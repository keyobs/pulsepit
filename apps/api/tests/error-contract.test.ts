import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { ErrorResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-error-contract-'));
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, app };
}

test('shared error contract accepts business errors with and without a code', async (t) => {
  const { root, app } = await fixture(t);
  const missing = await app.inject({
    method: 'GET',
    url: `/api/repositories/origin?${new URLSearchParams({ path: join(root, 'missing') })}`,
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(ErrorResponse.parse(missing.json()), {
    error: 'Repository not found in configured scan directories.',
  });

  // Outdated fails before launching a command when package.json is absent.
  const path = join(root, 'without-package');
  await mkdir(join(path, '.git'), { recursive: true });
  const unsupported = await app.inject({
    method: 'POST',
    url: '/api/repositories/outdated',
    payload: { path },
  });
  assert.equal(unsupported.statusCode, 422);
  assert.deepEqual(ErrorResponse.parse(unsupported.json()), {
    code: 'PACKAGE_MANAGER',
    error: 'No package manager detected for this repository.',
  });
});

test('shared error contract preserves the detailed validation message from Fastify', async (t) => {
  const { app } = await fixture(t);
  for (const request of [
    { method: 'GET' as const, url: '/api/repositories/origin' },
    { method: 'POST' as const, url: '/api/repositories/fetch', payload: {} },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 400);
    const parsed = ErrorResponse.parse(response.json());
    assert.equal(parsed.code, 'FST_ERR_VALIDATION');
    assert.equal(parsed.error, 'Bad Request');
    assert.ok(parsed.message?.includes('path'));
    assert.equal(parsed.message ?? parsed.error, response.json().message);
  }
});

test('shared error contract tolerates extra fields and future codes but rejects invalid types', () => {
  assert.deepEqual(
    ErrorResponse.parse({
      error: 'The operation failed.',
      code: 'FUTURE_ERROR_CODE',
      path: '/repos/project',
      success: false,
    }),
    { error: 'The operation failed.', code: 'FUTURE_ERROR_CODE' },
  );
  for (const invalid of [
    {},
    { message: 'Missing required error field.' },
    { error: 42 },
    { error: 'Failed.', code: 400 },
    { error: 'Failed.', message: null },
  ]) {
    assert.equal(ErrorResponse.safeParse(invalid).success, false);
  }
});
