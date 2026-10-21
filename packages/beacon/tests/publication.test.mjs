import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('publication metadata targets the monorepo owner and has no private workspace dependencies', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.name, '@keyobs/pulsepit-beacon');
  assert.equal(manifest.private, false);
  assert.equal(manifest.publishConfig.registry, 'https://npm.pkg.github.com');
  assert.equal(
    manifest.repository.url,
    'git+https://github.com/keyobs/pulsepit.git',
  );
  assert.equal(manifest.repository.directory, 'packages/beacon');
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.peerDependencies ?? {}, {});
});

test('published archive installs offline outside the monorepo and exposes both entry points', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-beacon-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    npm_config_cache: join(root, 'cache'),
    npm_config_update_notifier: 'false',
  };
  const { stdout } = await execute(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
    { cwd: packageRoot, env },
  );
  const [archive] = JSON.parse(stdout);
  assert.equal(archive.name, '@keyobs/pulsepit-beacon');
  assert.deepEqual(archive.files.map((file) => file.path).sort(), [
    'README.md',
    'dist/index.d.ts',
    'dist/index.js',
    'package.json',
    'static/index.d.ts',
    'static/index.mjs',
  ]);
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  await execute(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(root, archive.filename),
    ],
    { cwd: consumer, env },
  );
  await writeFile(
    join(consumer, 'verify.mjs'),
    `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBeaconManifest } from '@keyobs/pulsepit-beacon';
import { writeBeaconManifest } from '@keyobs/pulsepit-beacon/static';
const options = { name: 'consumer', env: 'production' };
const manifest = createBeaconManifest(options);
await writeBeaconManifest('dist/pulsepit-deployment.json', options);
assert.deepEqual(JSON.parse(await readFile('dist/pulsepit-deployment.json', 'utf8')), manifest);
assert.equal(manifest.app.deployedAt, null);
console.log('Standalone package imports verified.');
`,
  );
  const result = await execute(process.execPath, ['verify.mjs'], {
    cwd: consumer,
    env,
  });
  assert.match(result.stdout, /Standalone package imports verified/);
});
