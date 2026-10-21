import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('distribution includes the beacon README and matches the patch version in both manifests', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-beacon-readme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expected = await readFile(
    new URL('../README.md', import.meta.url),
    'utf8',
  );
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  );
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  const { stdout } = await execute(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
    {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: join(root, 'cache') },
    },
  );
  const [archive] = JSON.parse(stdout);
  assert.equal(archive.version, manifest.version);
  assert.ok(archive.files.some((file) => file.path === 'README.md'));
  const { stdout: publishedReadme } = await execute('tar', [
    '-xOf',
    join(root, archive.filename),
    'package/README.md',
  ]);
  assert.equal(publishedReadme, expected);
  assert.match(publishedReadme, /^# @keyobs\/pulsepit-beacon/m);
});
