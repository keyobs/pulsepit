import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { OriginRemote, OriginResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

test('origin responses satisfy the shared contract', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-origin-contract-'));
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  async function repository(name: string, remote?: string) {
    const path = join(root, name);
    await execute('git', ['init', '--initial-branch=main', path]);
    if (remote) {
      await execute('git', ['remote', 'add', 'origin', remote], { cwd: path });
    }
    return path;
  }

  async function readOrigin(path: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/origin?${new URLSearchParams({ path })}`,
    });
    assert.equal(response.statusCode, 200);
    const json: unknown = response.json();
    const parsed = OriginResponse.parse(json);
    assert.deepEqual(parsed, json);
    assert.equal(parsed.path, path);
    return parsed;
  }

  await t.test(
    'validates a GitHub origin from an actual route response',
    async () => {
      const path = await repository(
        'github',
        'https://github.com/zeebha/pulsepit.git',
      );
      const result = await readOrigin(path);
      assert.deepEqual(result.origin, {
        name: 'origin',
        url: 'https://github.com/zeebha/pulsepit.git',
        github: {
          owner: 'zeebha',
          repo: 'pulsepit',
          url: 'https://github.com/zeebha/pulsepit',
        },
      });
      assert.equal(result.originError, null);
    },
  );

  await t.test(
    'accepts GitLab and SCP URLs without a GitHub identity',
    async () => {
      const path = await repository(
        'gitlab',
        'git@gitlab.com:group/project.git',
      );
      const result = await readOrigin(path);
      assert.deepEqual(result.origin, {
        name: 'origin',
        url: 'git@gitlab.com:group/project.git',
        github: null,
      });
      assert.equal(result.originError, null);
    },
  );

  await t.test('preserves a missing origin as explicit nulls', async () => {
    const path = await repository('without-origin');
    assert.deepEqual(await readOrigin(path), {
      path,
      origin: null,
      originError: null,
    });
  });

  await t.test('accepts an origin whose URL cannot be exposed', async () => {
    const path = await repository('unsupported-url', 'ext::unsupported-helper');
    const result = await readOrigin(path);
    assert.deepEqual(result.origin, {
      name: 'origin',
      url: null,
      github: null,
    });
    assert.equal(result.originError, null);
  });

  await t.test(
    'preserves a Git read failure in the response contract',
    async () => {
      const path = join(root, 'invalid-git');
      await mkdir(join(path, '.git'), { recursive: true });
      const result = await readOrigin(path);
      assert.equal(result.origin, null);
      assert.equal(
        result.originError,
        'Unable to read origin for this repository.',
      );
    },
  );
});

test('origin contracts reject missing fields and invalid nested values', () => {
  for (const origin of [
    { name: 'upstream', url: null, github: null },
    { name: 'origin', github: null },
    { name: 'origin', url: 42, github: null },
    {
      name: 'origin',
      url: null,
      github: { repo: 'pulsepit', url: 'https://github.com/zeebha/pulsepit' },
    },
  ]) {
    assert.equal(OriginRemote.safeParse(origin).success, false);
  }
  for (const response of [
    { path: '/repos/project', origin: null },
    { path: '/repos/project', origin: null, originError: 42 },
    { origin: null, originError: null },
  ]) {
    assert.equal(OriginResponse.safeParse(response).success, false);
  }
});
