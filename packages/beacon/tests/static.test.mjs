import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeBeaconManifest } from '../static/index.mjs';

test('static generator writes public metadata in nested output directories without inventing a deployment date', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-beacon-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'dist', 'pulsepit-deployment.json');
  const manifest = await writeBeaconManifest(output, {
    name: 'izeetok',
    env: 'staging',
    version: '0.1.0',
    commit: 'a'.repeat(40),
    token: 'never-public',
  });
  const content = await readFile(output, 'utf8');
  assert.deepEqual(JSON.parse(content), manifest);
  assert.equal(manifest.app.deployedAt, null);
  assert.equal(content.includes('never-public'), false);
  assert.equal('health' in manifest, false);
  assert.equal('observedAt' in manifest, false);
  await writeBeaconManifest(output, {
    name: 'izeetok',
    env: 'production',
    version: '0.2.0',
  });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).app.version, '0.2.0');
});

test('static generator validates before overwriting an existing deployment file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-beacon-validation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'pulsepit-deployment.json');
  await writeBeaconManifest(output, { name: 'izeetok', env: 'staging' });
  const previous = await readFile(output, 'utf8');
  await assert.rejects(
    writeBeaconManifest(output, {
      name: 'izeetok',
      env: 'production',
      deployedAt: 'not-a-deployment-date',
    }),
    /deployedAt/,
  );
  assert.equal(await readFile(output, 'utf8'), previous);
});
