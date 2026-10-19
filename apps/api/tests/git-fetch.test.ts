import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

test('fetch one configured repository', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-fetch-'));
  const projects = join(root, 'projects');
  const source = join(root, 'source');
  const origin = join(root, 'origin.git');
  const upstream = join(root, 'upstream.git');
  const repository = join(projects, 'repository with spaces');
  const sibling = join(projects, 'sibling');
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function git(cwd: string, ...args: string[]) {
    return (await execute('git', args, { cwd })).stdout.trim();
  }
  await mkdir(projects);
  await mkdir(source);
  await git(source, 'init', '--initial-branch=main');
  await writeFile(join(source, 'tracked.txt'), 'initial\n');
  await git(source, 'add', 'tracked.txt');
  await git(
    source,
    '-c',
    'user.name=Pulsepit Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'Initial',
  );
  await git(source, 'branch', 'stale');
  await git(root, 'clone', '--bare', source, origin);
  await git(root, 'clone', '--bare', source, upstream);
  await git(root, 'clone', origin, repository);
  await git(root, 'clone', origin, sibling);
  await git(repository, 'remote', 'add', 'upstream', upstream);
  await git(repository, 'fetch', 'upstream');
  await git(source, 'remote', 'add', 'origin', origin);
  await git(source, 'remote', 'add', 'upstream', upstream);

  await t.test(
    'fetches all remotes, prunes stale refs and preserves local work',
    async () => {
      const previousHead = await git(repository, 'rev-parse', 'HEAD');
      const siblingRef = await git(
        sibling,
        'rev-parse',
        'refs/remotes/origin/main',
      );
      await writeFile(join(repository, 'tracked.txt'), 'local changes\n');
      await writeFile(join(repository, 'untracked.txt'), 'local file\n');
      const status = await git(repository, 'status', '--porcelain');
      await writeFile(join(source, 'tracked.txt'), 'remote changes\n');
      await git(source, 'add', 'tracked.txt');
      await git(
        source,
        '-c',
        'user.name=Pulsepit Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'Remote update',
      );
      const latest = await git(source, 'rev-parse', 'HEAD');
      await git(source, 'push', 'origin', 'main', ':stale');
      await git(source, 'push', 'upstream', 'main', 'main:feature', ':stale');

      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/fetch',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { path: repository, success: true });
      assert.equal(
        await git(repository, 'rev-parse', 'refs/remotes/origin/main'),
        latest,
      );
      assert.equal(
        await git(repository, 'rev-parse', 'refs/remotes/upstream/main'),
        latest,
      );
      assert.equal(
        await git(repository, 'rev-parse', 'refs/remotes/upstream/feature'),
        latest,
      );
      const refs = await git(
        repository,
        'for-each-ref',
        '--format=%(refname)',
        'refs/remotes',
      );
      assert.ok(!refs.includes('/stale'));
      assert.equal(await git(repository, 'rev-parse', 'HEAD'), previousHead);
      assert.equal(await git(repository, 'status', '--porcelain'), status);
      assert.equal(
        await readFile(join(repository, 'tracked.txt'), 'utf8'),
        'local changes\n',
      );
      assert.equal(
        await readFile(join(repository, 'untracked.txt'), 'utf8'),
        'local file\n',
      );
      assert.equal(
        await git(sibling, 'rev-parse', 'refs/remotes/origin/main'),
        siblingRef,
      );
    },
  );

  await t.test(
    'rejects invalid requests and unconfigured repository paths',
    async () => {
      for (const payload of [{}, { path: '' }, { path: '   ' }]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/fetch',
          payload,
        });
        assert.equal(response.statusCode, 400);
      }
      const link = join(projects, 'linked');
      await symlink(source, link, 'dir');
      for (const path of [
        source,
        origin,
        projects,
        join(projects, 'missing'),
        link,
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/fetch',
          payload: { path },
        });
        assert.equal(response.statusCode, 404);
      }
    },
  );

  await t.test('reports remote failures in English', async () => {
    await git(
      repository,
      'remote',
      'set-url',
      'upstream',
      join(root, 'missing-remote.git'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/fetch',
      payload: { path: repository },
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().success, false);
    assert.equal(response.json().code, 'FETCH_FAILED');
    assert.match(response.json().error, /Unable to fetch/);
  });

  await t.test('stops a hung fetch after 30 seconds', async (r) => {
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(
      join(bin, 'git'),
      `#!/bin/sh
unset NODE_TEST_CONTEXT
exec "${process.execPath}" "${join(bin, 'hung-git.cjs')}" "$@"
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, 'hung-git.cjs'),
      `
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['fetch', '--all', '--prune']);
assert.equal(process.env.GIT_TERMINAL_PROMPT, '0');
assert.equal(process.env.GCM_INTERACTIVE, 'Never');
setInterval(() => {}, 1000);
`,
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ''}`;
    r.after(() => {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    });
    const pending = app.inject({
      method: 'POST',
      url: '/api/repositories/fetch',
      payload: { path: repository },
    });
    const response = await pending;
    assert.equal(response.statusCode, 504);
    assert.equal(response.json().code, 'TIMEOUT');
  });
});
