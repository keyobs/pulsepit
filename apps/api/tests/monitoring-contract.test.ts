import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  ErrorResponse,
  MonitoringRequest,
  MonitoringResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import type { RepositoryUrls } from '../src/services/repository-config.service.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-monitoring-contract-'));
  const path = join(root, 'project');
  const urls: RepositoryUrls = {};
  const app = buildApp({ port: 3001, scanPaths: [root] }, urls);
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(path, '.git'), { recursive: true });
  const monitor = () =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/monitoring',
      payload: MonitoringRequest.parse({ path: `${path}/.` }),
    });
  return { root, path, app, urls, monitor };
}

test('monitoring contract parses online, HTTP failure and network failure results in a successful API response', async (t) => {
  const { path, urls, monitor } = await fixture(t);
  urls[path] = {
    healthy: 'https://healthy.example.invalid',
    'http-failure': 'https://http-failure.example.invalid',
    'network-failure': 'https://network-failure.example.invalid',
  };
  const mockedFetch = t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown) => {
      if (String(input) === urls[path].healthy)
        return new Response(null, { status: 204 });
      if (String(input) === urls[path]['http-failure'])
        return new Response(null, { status: 503 });
      throw new TypeError('Simulated network failure.');
    },
  );

  const response = await monitor();
  assert.equal(response.statusCode, 200);
  const parsed = MonitoringResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  assert.equal(parsed.configured, true);
  assert.equal(mockedFetch.mock.calls.length, 3);
  assert.deepEqual(
    parsed.checks.map((check) => check.environment),
    ['healthy', 'http-failure', 'network-failure'],
  );
  const [healthy, httpFailure, networkFailure] = parsed.checks;
  assert.equal(healthy.status, 'online');
  assert.equal(healthy.statusCode, 204);
  assert.equal(healthy.errorCode, null);
  assert.equal(healthy.error, null);
  assert.equal(httpFailure.status, 'offline');
  assert.equal(httpFailure.statusCode, 503);
  assert.equal(httpFailure.errorCode, 'HTTP_ERROR');
  assert.equal(typeof httpFailure.error, 'string');
  assert.equal(networkFailure.status, 'offline');
  assert.equal(networkFailure.statusCode, null);
  assert.equal(networkFailure.errorCode, 'NETWORK_ERROR');
  assert.equal(typeof networkFailure.error, 'string');
  for (const check of parsed.checks) {
    assert.equal(check.url, urls[path][check.environment]);
    assert.equal(new Date(check.checkedAt).toISOString(), check.checkedAt);
  }
});

test('monitoring contract distinguishes no configured URLs from API validation and lookup failures', async (t) => {
  const { root, path, app, monitor } = await fixture(t);
  const mockedFetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No fetch should occur for an unconfigured repository.');
  });
  const response = await monitor();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(MonitoringResponse.parse(response.json()), {
    path,
    configured: false,
    checks: [],
  });
  assert.equal(mockedFetch.mock.calls.length, 0);

  for (const [payload, status] of [
    [{}, 400],
    [{ path: root }, 404],
  ] as const) {
    const failure = await app.inject({
      method: 'POST',
      url: '/api/repositories/monitoring',
      payload,
    });
    assert.equal(failure.statusCode, status);
    assert.equal(typeof ErrorResponse.parse(failure.json()).error, 'string');
    assert.equal(MonitoringResponse.safeParse(failure.json()).success, false);
  }
  assert.equal(mockedFetch.mock.calls.length, 0);
});
