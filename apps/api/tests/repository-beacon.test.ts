import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { hasConfiguredBeacon } from '../src/services/repository-beacon.service.js';

const name = '@keyobs/pulsepit-beacon';

async function fixture(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'pulsepit-local-beacon-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const file = join(path, 'package.json');
  const write = (manifest: unknown) =>
    writeFile(file, JSON.stringify(manifest));
  return { path, file, write };
}

test('beacon requires both a direct declaration and a configured metadata source, without node_modules or network', async (t) => {
  const { path, write } = await fixture(t);
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  for (const section of ['dependencies', 'devDependencies']) {
    await write({ [section]: { [name]: '0.1.1' } });
    assert.equal(await hasConfiguredBeacon(path, true), true);
    assert.equal(await hasConfiguredBeacon(path, false), false);
  }
  await write({ dependencies: { other: '^1.0.0' } });
  assert.equal(await hasConfiguredBeacon(path, true), false);
  assert.equal(await hasConfiguredBeacon(path, false), false);
  assert.equal(mocked.mock.calls.length, 0);
});

test('beacon ignores names, scripts, workspace packages, peers and optional declarations outside the chosen sections', async (t) => {
  const { path, write } = await fixture(t);
  for (const manifest of [
    { name, version: '0.1.1' },
    { scripts: { build: 'node scripts/generateBeacon.mjs' } },
    { workspaces: ['packages/beacon'] },
    { peerDependencies: { [name]: '0.1.1' } },
    { optionalDependencies: { [name]: '0.1.1' } },
    { dependencies: { '@pulsepit/beacon': '0.1.0' } },
    { dependencies: { '@keyobs/pulsepit-beacon-extra': '0.1.1' } },
  ]) {
    await write(manifest);
    assert.equal(await hasConfiguredBeacon(path, true), false);
  }
});

test('beacon rejects malformed declarations while allowing a valid development declaration alongside invalid dependencies', async (t) => {
  const { path, write } = await fixture(t);
  for (const dependencies of [
    null,
    [],
    name,
    { [name]: '' },
    { [name]: ' ' },
    { [name]: null },
    { [name]: true },
    { [name]: {} },
  ]) {
    await write({ dependencies });
    assert.equal(await hasConfiguredBeacon(path, true), false);
    await write({ dependencies, devDependencies: { [name]: '^0.1.1' } });
    assert.equal(await hasConfiguredBeacon(path, true), true);
  }
});

test('beacon stays false for missing or invalid manifests and rechecks working-tree changes without a stale cache', async (t) => {
  const { path, file, write } = await fixture(t);
  assert.equal(await hasConfiguredBeacon(path, true), false);
  for (const text of ['{invalid JSON', 'null', '[]', '"package"']) {
    await writeFile(file, text);
    assert.equal(await hasConfiguredBeacon(path, true), false);
  }
  await write({ devDependencies: { [name]: '0.1.1' } });
  assert.equal(await hasConfiguredBeacon(path, true), true);
  await write({ devDependencies: {} });
  assert.equal(await hasConfiguredBeacon(path, true), false);
});
