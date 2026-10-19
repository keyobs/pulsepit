import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import { getOutdatedDependencies } from '../src/services/outdated.service.js';

test('on-demand npm dependency diagnostics', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-outdated-'));
  const repository = join(root, 'repository with spaces');
  const bin = join(root, 'bin');
  const previousPath = process.env.PATH;
  const manifest = JSON.stringify({ packageManager: 'npm@11.0.0' });
  await mkdir(repository);
  await mkdir(bin);
  await promisify(execFile)('git', ['init', repository]);
  await writeFile(join(repository, 'package.json'), manifest);
  await writeFile(
    join(bin, 'npm'),
    `#!/bin/sh
unset NODE_TEST_CONTEXT
exec "${process.execPath}" "${join(bin, 'npm.cjs')}" "$@"
`,
    { mode: 0o755 },
  );
  // A local executable exercises real subprocess exit codes without a registry.
  await writeFile(
    join(bin, 'npm.cjs'),
    `
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.deepEqual(process.argv.slice(2), ['outdated', '--json', '--ignore-scripts']);
const fixture = JSON.parse(fs.readFileSync('.diagnostic-fixture.json', 'utf8'));
if (fixture.hang) setInterval(() => {}, 1000);
else {
  process.stdout.write(fixture.output);
  process.exitCode = fixture.exitCode;
}
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  });

  async function fixture(output: unknown, exitCode = 0, hang = false) {
    await writeFile(
      join(repository, '.diagnostic-fixture.json'),
      JSON.stringify({
        output: typeof output === 'string' ? output : JSON.stringify(output),
        exitCode,
        hang,
      }),
    );
  }

  await t.test(
    'accepts exit 1 and preserves missing versions and workspace entries',
    async () => {
      await fixture(
        {
          z: { current: '1.0.0', wanted: '1.1.0', latest: '2.0.0' },
          a: [
            { wanted: '3.0.0', latest: '3.0.0', dependent: 'web' },
            {
              current: '2.0.0',
              wanted: '3.0.0',
              latest: '3.0.0',
              dependent: 'api',
            },
          ],
        },
        1,
      );
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.packageManager, 'npm');
      assert.deepEqual(
        body.dependencies.map((entry: { name: string }) => entry.name),
        ['a', 'a', 'z'],
      );
      assert.equal(body.dependencies[0].current, null);
      assert.equal(body.dependencies[1].dependent, 'api');
      assert.equal(body.dependencies[2].wanted, '1.1.0');
      assert.equal(
        await readFile(join(repository, 'package.json'), 'utf8'),
        manifest,
      );
    },
  );

  await t.test('returns an empty report when nothing is outdated', async () => {
    await fixture({});
    assert.deepEqual(await getOutdatedDependencies(repository), {
      packageManager: 'npm',
      dependencies: [],
      error: null,
    });
  });

  await t.test(
    'rejects technical errors, invalid JSON and malformed reports',
    async () => {
      for (const output of [
        { error: { code: 'EAI_AGAIN' } },
        'not json',
        { broken: { current: '1' } },
      ]) {
        await fixture(output, 1);
        const result = await getOutdatedDependencies(repository);
        assert.ok(result.error);
        assert.ok('code' in result && result.code === 'INVALID_OUTPUT');
      }
      await fixture({}, 1);
      const result = await getOutdatedDependencies(repository);
      assert.ok('code' in result && result.code === 'COMMAND_FAILED');
      await fixture({}, 2);
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 502);
    },
  );

  await t.test(
    'validates the request and restricts paths to configured repositories',
    async () => {
      for (const payload of [{}, { path: '' }, { path: '   ' }]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload,
        });
        assert.equal(response.statusCode, 400);
      }
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: tmpdir() },
      });
      assert.equal(response.statusCode, 404);
    },
  );

  await t.test(
    'reports unsupported, undetected and invalid package managers',
    async () => {
      for (const content of [
        { packageManager: 'pnpm@12.0.0' },
        { packageManager: 'yarn@4.0.0' },
        {},
        { packageManager: 'invalid' },
      ]) {
        await writeFile(
          join(repository, 'package.json'),
          JSON.stringify(content),
        );
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload: { path: repository },
        });
        assert.equal(response.statusCode, 422);
        assert.equal(response.json().code, 'PACKAGE_MANAGER');
      }
      await writeFile(join(repository, 'package.json'), manifest);
    },
  );

  await t.test('reports a missing npm executable', async () => {
    process.env.PATH = root;
    try {
      const result = await getOutdatedDependencies(repository);
      assert.ok('code' in result && result.code === 'COMMAND_FAILED');
      assert.equal(result.error, 'npm executable was not found in PATH.');
    } finally {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
    }
  });

  await t.test('terminates a hung command after 30 seconds', async () => {
    await fixture({}, 0, true);
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path: repository },
    });
    assert.equal(response.statusCode, 504);
    assert.equal(response.json().code, 'TIMEOUT');
  });
});
