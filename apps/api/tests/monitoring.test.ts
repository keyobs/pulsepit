import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { checkDeploymentUrls } from '../src/services/monitoring.service.js';

test('on-demand deployment monitoring', async (t) => {
  const requests: string[] = [];
  let active = 0;
  let maximum = 0;
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/ok' }).end();
    } else if (request.url === '/unhealthy') {
      response.writeHead(503).end();
    } else if (request.url === '/disconnect') {
      response.destroy();
    } else if (
      request.url === '/fallback405' ||
      request.url === '/fallback501'
    ) {
      response
        .writeHead(
          request.method === 'HEAD'
            ? request.url === '/fallback405'
              ? 405
              : 501
            : 200,
        )
        .end();
    } else if (request.url === '/slow-fallback') {
      const timer = setTimeout(
        () => response.writeHead(request.method === 'HEAD' ? 405 : 200).end(),
        request.method === 'HEAD' ? 10 : 200,
      );
      response.once('close', () => clearTimeout(timer));
    } else if (request.url?.startsWith('/limited/')) {
      active++;
      maximum = Math.max(maximum, active);
      response.once('finish', () => active--);
      const timer = setTimeout(() => response.end(), 30);
      response.once('close', () => clearTimeout(timer));
    } else {
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-monitoring-'));
  const repository = join(root, 'repository');
  const empty = join(root, 'empty');
  await mkdir(join(repository, '.git'), { recursive: true });
  await mkdir(join(empty, '.git'), { recursive: true });
  const app = buildApp(
    { port: 3001, scanPaths: [root] },
    {
      [repository]: {
        production: `${base}/ok`,
        staging: `${base}/unhealthy`,
      },
    },
  );
  t.after(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });

  await t.test(
    'reports successful, redirected and unhealthy HTTP responses independently',
    async () => {
      const result = await checkDeploymentUrls({
        staging: `${base}/unhealthy`,
        production: `${base}/redirect`,
      });
      assert.equal(result.configured, true);
      assert.deepEqual(
        result.checks.map((check) => [
          check.environment,
          check.status,
          check.statusCode,
          check.errorCode,
        ]),
        [
          ['production', 'online', 200, null],
          ['staging', 'offline', 503, 'HTTP_ERROR'],
        ],
      );
      for (const check of result.checks) {
        assert.ok(check.responseTimeMs >= 0);
        assert.ok(Number.isFinite(Date.parse(check.checkedAt)));
      }
    },
  );

  await t.test('falls back from HEAD to GET for 405 and 501', async () => {
    for (const status of [405, 501]) {
      const result = await checkDeploymentUrls({
        production: `${base}/fallback${status}`,
      });
      assert.equal(result.checks[0].status, 'online');
      assert.ok(requests.includes(`HEAD /fallback${status}`));
      assert.ok(requests.includes(`GET /fallback${status}`));
    }
  });

  await t.test(
    'shares the deadline across HEAD and GET and separates network errors',
    async () => {
      const result = await checkDeploymentUrls(
        {
          timeout: `${base}/slow-fallback`,
          disconnected: `${base}/disconnect`,
        },
        80,
      );
      const timeout = result.checks.find(
        (check) => check.environment === 'timeout',
      );
      const disconnected = result.checks.find(
        (check) => check.environment === 'disconnected',
      );
      assert.equal(timeout?.status, 'offline');
      assert.equal(timeout?.statusCode, null);
      assert.equal(timeout?.errorCode, 'TIMEOUT');
      assert.equal(disconnected?.errorCode, 'NETWORK_ERROR');
    },
  );

  await t.test('limits concurrent checks to four connections', async () => {
    const urls = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `env${index}`,
        `${base}/limited/${index}`,
      ]),
    );
    const result = await checkDeploymentUrls(urls);
    assert.equal(result.checks.length, 9);
    assert.ok(result.checks.every((check) => check.status === 'online'));
    assert.ok(maximum <= 4);
    assert.ok(maximum > 1);
  });

  await t.test(
    'returns HTTP 200 for a completed diagnosis containing an offline environment',
    async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/monitoring',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().path, repository);
      assert.equal(response.json().checks[1].status, 'offline');
      assert.equal(response.json().checks[1].errorCode, 'HTTP_ERROR');
    },
  );

  await t.test(
    'returns an unconfigured result without HTTP requests',
    async () => {
      const before = requests.length;
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/monitoring',
        payload: { path: empty },
      });
      assert.deepEqual(response.json(), {
        path: empty,
        configured: false,
        checks: [],
      });
      assert.equal(requests.length, before);
    },
  );

  await t.test(
    'rejects invalid input and repositories outside configured directories',
    async () => {
      const before = requests.length;
      for (const payload of [{}, { path: '' }, { path: ' ' }]) {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/repositories/monitoring',
              payload,
            })
          ).statusCode,
          400,
        );
      }
      for (const path of [root, join(root, 'missing')]) {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/repositories/monitoring',
              payload: { path },
            })
          ).statusCode,
          404,
        );
      }
      assert.equal(requests.length, before);
    },
  );
});
