import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBeaconManifest } from '../dist/index.js';

test('manifest keeps unknown deployment data null without inferring dates or health', () => {
  assert.deepEqual(
    createBeaconManifest({ name: 'project', env: 'production' }),
    {
      protocolVersion: 1,
      app: {
        name: 'project',
        version: null,
        commit: null,
        env: 'production',
        deployedAt: null,
      },
    },
  );
});

test('manifest preserves explicit metadata and normalizes complete SHAs and UTC dates', () => {
  for (const length of [40, 64]) {
    const options = {
      name: 'project',
      env: 'staging',
      version: '2.4.0',
      commit: 'A'.repeat(length),
      deployedAt: '2026-10-21T10:30:00Z',
    };
    const manifest = createBeaconManifest(options);
    assert.deepEqual(manifest.app, {
      ...options,
      commit: 'a'.repeat(length),
      deployedAt: '2026-10-21T10:30:00.000Z',
    });
    assert.equal(options.commit, 'A'.repeat(length));
  }
  assert.equal(
    createBeaconManifest({
      name: 'project',
      env: 'production',
      deployedAt: '2024-02-29T12:00:00.1Z',
    }).app.deployedAt,
    '2024-02-29T12:00:00.100Z',
  );
});

test('manifest rejects invalid metadata without echoing values in errors', () => {
  const valid = { name: 'project', env: 'production' };
  for (const options of [
    null,
    [],
    'invalid',
    {},
    { ...valid, name: ' ' },
    { ...valid, env: 42 },
    { ...valid, version: 'x'.repeat(129) },
    { ...valid, commit: 'short-secret-value' },
    ...[
      '2026-02-30T10:30:00Z',
      '2026-10-21T24:00:00Z',
      '2026-10-21',
      '2026-10-21T12:30:00+02:00',
      'secret-value',
    ].map((deployedAt) => ({ ...valid, deployedAt })),
  ]) {
    assert.throws(
      () => createBeaconManifest(options),
      (error) => {
        assert.ok(error instanceof TypeError);
        assert.equal(error.message.includes('secret-value'), false);
        return true;
      },
    );
  }
});

test('manifest includes only declared public fields and returns independent objects', () => {
  const options = {
    name: 'project',
    env: 'production',
    token: 'server-secret',
    internalPath: '/private/app',
  };
  const first = createBeaconManifest(options);
  const second = createBeaconManifest(options);
  assert.equal(JSON.stringify(first).includes('server-secret'), false);
  assert.equal(JSON.stringify(first).includes('/private/app'), false);
  first.app.name = 'changed';
  assert.equal(second.app.name, 'project');
  assert.equal(options.name, 'project');
});
