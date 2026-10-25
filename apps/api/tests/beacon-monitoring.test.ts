import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  type BeaconMonitoringInterval,
  BeaconMonitoringResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { collectDeploymentMetadata } from '../src/services/beacon/deployment-metadata.service.js';
import {
  type ConfiguredDeploymentEnvironment,
  getDeploymentEnvironments,
  loadRepositoryDeploymentConfig,
} from '../src/services/repositories/repository-config.service.js';

const environment = (
  name: string,
  enabled = true,
  interval: BeaconMonitoringInterval = '5m',
): ConfiguredDeploymentEnvironment => ({
  environment: name,
  label: name,
  branch: null,
  url: null,
  hosting: null,
  metadata: {
    type: 'static',
    url: `https://private.invalid/${name}`,
    monitoring: { enabled, interval },
  },
});
const document = (env: string) => ({
  protocolVersion: 1,
  app: {
    name: 'project',
    env,
    version: '1.0.0',
    commit: null,
    deployedAt: null,
  },
});
async function until(check: () => boolean | Promise<boolean>) {
  const start = performance.now();
  while (!(await check())) {
    assert.ok(performance.now() - start < 3_000, 'condition timed out');
    await setImmediate();
  }
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-beacon-monitoring-'));
  const path = join(root, 'project');
  await mkdir(join(path, '.git'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = (environments: ConfiguredDeploymentEnvironment[]) => {
    const result = buildApp(
      { port: 3001, scanPaths: [root] },
      {},
      {},
      { [path]: environments },
    );
    result.log.level = 'silent';
    t.after(() => result.close());
    return result;
  };
  return { root, path, app };
}
const snapshot = async (app: ReturnType<typeof buildApp>) => {
  const response = await app.inject({ method: 'GET', url: '/api/monitoring' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes('private.invalid'), false);
  return BeaconMonitoringResponse.parse(response.json()).environments;
};

test('monitoring configuration is strict, isolated per repository and excluded from public settings', async (t) => {
  const { root, path } = await fixture(t);
  const file = join(root, 'config.json');
  const good = environment('production');
  const bad = join(root, 'bad');
  for (const monitoring of [
    null,
    {},
    { enabled: 'true', interval: '5m' },
    { enabled: true, interval: '1m' },
    { enabled: false },
    { enabled: true, interval: '5m', token: 'secret' },
  ]) {
    await writeFile(
      file,
      JSON.stringify({
        repositories: {
          [path]: { deployments: { production: good } },
          [bad]: {
            deployments: {
              production: {
                ...good,
                metadata: { ...good.metadata, monitoring },
              },
            },
          },
        },
      }),
    );
    const config = await loadRepositoryDeploymentConfig(file, {
      isolateInvalidRepositories: true,
    });
    assert.equal(config.errors?.[bad].code, 'INVALID_REPOSITORY_CONFIGURATION');
    assert.deepEqual(config.environments[bad], []);
    assert.equal(
      config.environments[path][0].metadata?.monitoring?.interval,
      '5m',
    );
    const publicSettings = getDeploymentEnvironments(
      path,
      config.environments,
      {},
      {},
    );
    assert.equal(JSON.stringify(publicSettings).includes('monitoring'), false);
    assert.equal(
      JSON.stringify(publicSettings).includes('private.invalid'),
      false,
    );
  }
  for (const interval of ['5m', '15m', '30m', '1h'] as const) {
    await writeFile(
      file,
      JSON.stringify({
        repositories: {
          [path]: {
            deployments: {
              production: environment('production', false, interval),
            },
          },
        },
      }),
    );
    assert.equal(
      (await loadRepositoryDeploymentConfig(file)).environments[path][0]
        .metadata?.monitoring?.interval,
      interval,
    );
  }
});

test('startup is nonblocking; states transition once, intervals follow completion and GET never reads a beacon', async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({
    apis: ['Date', 'setTimeout'],
    now: Date.parse('2026-10-25T12:00:00.000Z'),
  });
  let release!: (response: Response) => void;
  let next: Response | undefined;
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      next ??
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const off = environment('off', false);
  const absent = environment('absent');
  delete absent.metadata?.monitoring;
  const noSource = environment('no-source');
  delete noSource.metadata;
  const app = f.app([environment('production'), off, absent, noSource]);
  await app.ready();
  await until(() => fetch.mock.calls.length === 1);
  const initial = await snapshot(app);
  assert.equal(initial.length, 3);
  assert.equal(initial[0].status, 'pending');
  for (const state of initial.slice(1))
    assert.deepEqual(state, {
      path: f.path,
      environment: state.environment,
      enabled: false,
      interval: null,
      status: 'disabled',
      since: null,
      lastCheckedAt: null,
      error: null,
    });
  t.mock.timers.tick(600_000);
  assert.equal(fetch.mock.calls.length, 1); // No overlap or catch-up while pending.
  release(Response.json(document('production')));
  await until(async () => (await snapshot(app))[0].status === 'up');
  const up = (await snapshot(app))[0];
  assert.equal(up.since, '2026-10-25T12:10:00.000Z');
  next = new Response('', { status: 503 });
  t.mock.timers.tick(299_999);
  await snapshot(app);
  assert.equal(fetch.mock.calls.length, 1);
  t.mock.timers.tick(1);
  await until(async () => (await snapshot(app))[0].status === 'down');
  const down = (await snapshot(app))[0];
  assert.equal(down.error?.code, 'HTTP_ERROR');
  assert.equal(down.since, '2026-10-25T12:15:00.000Z');
  next = Response.json({ invalid: true });
  t.mock.timers.tick(300_000);
  await until(
    async () => (await snapshot(app))[0].error?.code === 'INVALID_RESPONSE',
  );
  const stillDown = (await snapshot(app))[0];
  assert.equal(stillDown.since, down.since);
  assert.equal(stillDown.lastCheckedAt, '2026-10-25T12:20:00.000Z');
  next = Response.json(document('production'));
  t.mock.timers.tick(300_000);
  await until(async () => (await snapshot(app))[0].status === 'up');
  assert.equal((await snapshot(app))[0].since, '2026-10-25T12:25:00.000Z');
  assert.equal(fetch.mock.calls.length, 4);
  await rm(join(f.path, '.git'), { recursive: true });
  assert.deepEqual(await snapshot(app), []);
  t.mock.timers.tick(300_000);
  await snapshot(app);
  assert.equal(fetch.mock.calls.length, 4);
  await app.close();
  t.mock.timers.tick(3_600_000);
  assert.equal(fetch.mock.calls.length, 4);
});

test('manual and periodic reads share four slots and preserve reader request guarantees', async (t) => {
  const f = await fixture(t);
  let active = 0;
  let maximum = 0;
  const releases: Array<() => void> = [];
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      active++;
      maximum = Math.max(maximum, active);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.deepEqual(init?.headers, { Accept: 'application/json' });
      assert.ok(init?.signal);
      return new Promise<Response>((resolve) =>
        releases.push(() => {
          active--;
          resolve(
            Response.json(document(new URL(String(url)).pathname.slice(1))),
          );
        }),
      );
    },
  );
  const environments = Array.from({ length: 6 }, (_, i) =>
    environment(`env${i}`),
  );
  const app = f.app(environments);
  await app.ready();
  await until(() => releases.length === 4);
  const manualEnvironment = environment('manual');
  assert.ok(manualEnvironment.metadata);
  const manual = collectDeploymentMetadata([manualEnvironment], {
    manual: manualEnvironment.metadata,
  });
  await setImmediate();
  assert.equal(fetch.mock.calls.length, 4);
  for (const release of releases.slice()) release();
  await until(() => releases.length === 7);
  assert.ok(maximum <= 4);
  for (const release of releases.slice(4)) release();
  assert.equal((await manual)[0].metadataError, null);
  await until(async () =>
    (await snapshot(app)).every((entry) => entry.status === 'up'),
  );
  assert.equal(maximum, 4);
});

test('shutdown aborts active and queued reads without rescheduling; out-of-scope configurations never fetch', async (t) => {
  const f = await fixture(t);
  let aborted = 0;
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted++;
            reject(init.signal?.reason);
          },
          { once: true },
        );
      }),
  );
  const environments = Array.from({ length: 6 }, (_, i) =>
    environment(`env${i}`),
  );
  const app = buildApp(
    { port: 3001, scanPaths: [f.root] },
    {},
    {},
    {
      [f.path]: environments,
      '/outside/scan': [environment('outside')],
      [join(f.root, 'missing')]: [environment('missing')],
    },
  );
  app.log.level = 'silent';
  t.after(() => app.close());
  await app.ready();
  await until(() => fetch.mock.calls.length === 4);
  const state = await snapshot(app);
  assert.equal(state.length, 6);
  assert.ok(
    state.every((entry) => entry.path === f.path && entry.status === 'pending'),
  );
  await app.close();
  assert.equal(aborted, 4);
  await setImmediate();
  assert.equal(fetch.mock.calls.length, 4);
});
