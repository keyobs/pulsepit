import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import { getGitStatus } from '../src/services/git/git.service.js';
import { getPackageManifest } from '../src/services/packages/package.service.js';

const execute = promisify(execFile);

function patchEnvironment(t: TestContext, values: NodeJS.ProcessEnv) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-git-client-'));
  const path = join(root, 'project');
  t.after(() => rm(root, { recursive: true, force: true }));
  const realGit = (await execute('which', ['git'])).stdout.trim();
  await execute(realGit, ['init', '--initial-branch=main', path]);
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.2.3' }),
  );
  await execute(realGit, ['add', 'package.json'], { cwd: path });
  await execute(
    realGit,
    [
      '-c',
      'user.name=Git Client Test',
      '-c',
      'user.email=client@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--no-gpg-sign',
      '-m',
      'Initial',
    ],
    { cwd: path },
  );
  const helper = join(root, 'credential helper');
  const marker = join(root, 'helper-must-not-run');
  await writeFile(helper, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, {
    mode: 0o755,
  });
  const config = join(root, 'gitconfig');
  await writeFile(config, '[user]\n\tname = Environment Fixture\n');
  const bin = join(root, 'bin');
  await mkdir(bin);
  const log = join(root, 'commands.jsonl');
  await writeFile(
    join(bin, 'git'),
    `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
for (const key of ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'NODE_AUTH_TOKEN', 'PULSEPIT_TEST_SECRET', 'GIT_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'NODE_OPTIONS', 'HUSKY']) assert.equal(process.env[key], undefined, key);
assert.equal(process.env.GIT_TERMINAL_PROMPT, '0');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const result = cp.spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  patchEnvironment(t, {
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_TOKEN: 'fake-github',
    VERCEL_TOKEN: 'fake-vercel',
    NODE_AUTH_TOKEN: 'fake-registry',
    PULSEPIT_TEST_SECRET: 'fake-secret',
    GIT_DIR: '/must-not-use',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
    NODE_OPTIONS: '',
    HUSKY: '0',
    GIT_ASKPASS: undefined,
    SSH_ASKPASS: undefined,
    GIT_SSH: undefined,
    GIT_SSH_COMMAND: undefined,
    GIT_CONFIG_GLOBAL: undefined,
    GIT_CONFIG_SYSTEM: undefined,
  });
  const settings = {
    GIT_ASKPASS: helper,
    SSH_ASKPASS: helper,
    GIT_SSH: helper,
    GIT_SSH_COMMAND: `'${helper}'`,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
  };
  const calls = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  return { root, path, helper, marker, settings, log, calls };
}

test('both Git clients accept each retained authentication and configuration variable without leaking API secrets', async (t) => {
  const { path, marker, settings, log, calls } = await fixture(t);
  for (const [name, value] of Object.entries(settings)) {
    process.env[name] = value;
    try {
      assert.equal((await getGitStatus(path)).branch, 'main', name);
      const result = await getPackageManifest(path, 'main');
      assert.equal(result.error, null, name);
      assert.equal(result.manifest?.version, '1.2.3');
    } finally {
      delete process.env[name];
    }
  }
  Object.assign(process.env, settings);
  assert.equal((await getGitStatus(path)).isClean, true);
  assert.equal(
    (await getPackageManifest(path, 'head')).manifest?.version,
    '1.2.3',
  );
  const commands = (await readFile(log, 'utf8')).trim().split('\n');
  assert.equal(commands.length, 14);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(process.env.GITHUB_TOKEN, 'fake-github');
  assert.equal(calls.mock.calls.length, 0);
});

test('list, detail and package routes remain readable in an IDE Git environment', async (t) => {
  const { root, path, settings, marker, calls } = await fixture(t);
  Object.assign(process.env, settings);
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(() => app.close());
  const query = new URLSearchParams({ path });
  const list = await app.inject({ method: 'GET', url: '/api/repositories' });
  const detail = await app.inject({
    method: 'GET',
    url: `/api/repositories/detail?${query}`,
  });
  const manifest = await app.inject({
    method: 'GET',
    url: `/api/repositories/package?${query}&ref=main`,
  });
  for (const response of [list, detail, manifest]) {
    assert.equal(response.statusCode, 200);
    for (const secret of [
      'fake-github',
      'fake-vercel',
      'fake-registry',
      'fake-secret',
    ])
      assert.equal(response.body.includes(secret), false);
  }
  const repository = list.json().repositories[0];
  assert.equal(repository.gitError, null);
  assert.equal(repository.git.branch, 'main');
  assert.deepEqual(detail.json().git, repository.git);
  assert.equal(detail.json().gitError, null);
  assert.equal(manifest.json().manifest.version, '1.2.3');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(calls.mock.calls.length, 0);
});
