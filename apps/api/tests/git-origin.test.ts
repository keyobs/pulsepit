import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import {
  describeOrigin,
  getOriginRemote,
} from '../src/services/git-origin.service.js';

const execute = promisify(execFile);

test('origin remote and GitHub identity', async (t) => {
  await t.test('recognizes standard HTTPS and SSH GitHub URLs', () => {
    for (const url of [
      'https://github.com/zeebha/pulsepit.git',
      'git@github.com:zeebha/pulsepit.git',
      'ssh://git@github.com/zeebha/pulsepit.git',
      'ssh://git@github.com:22/zeebha/pulsepit.git',
      'https://GITHUB.COM/zeebha/pulsepit/',
    ]) {
      assert.deepEqual(describeOrigin(url).github, {
        owner: 'zeebha',
        repo: 'pulsepit',
        url: 'https://github.com/zeebha/pulsepit',
      });
    }
  });

  await t.test(
    'removes embedded authentication, query parameters and fragments',
    () => {
      const result = describeOrigin(
        'https://private-user:secret-token@github.com/zeebha/pulsepit.git?access_token=query-secret#fragment-secret',
      );
      assert.equal(result.url, 'https://github.com/zeebha/pulsepit.git');
      assert.equal(result.github?.repo, 'pulsepit');
      for (const secret of [
        'private-user',
        'secret-token',
        'query-secret',
        'fragment-secret',
      ]) {
        assert.ok(!JSON.stringify(result).includes(secret));
      }
      assert.equal(
        describeOrigin(
          'ssh://private-user:secret-token@github.com/zeebha/pulsepit.git',
        ).url,
        'ssh://github.com/zeebha/pulsepit.git',
      );
      assert.equal(
        describeOrigin('private-user@github.com:zeebha/pulsepit.git').url,
        'github.com:zeebha/pulsepit.git',
      );
    },
  );

  await t.test(
    'does not guess GitHub identity from aliases, other hosts or unsupported paths',
    () => {
      for (const url of [
        'git@gitlab.com:group/project.git',
        'git@github-personal:zeebha/pulsepit.git',
        'https://github.com.example.invalid/zeebha/pulsepit.git',
        'https://example.invalid/github.com/pulsepit',
        'https://github.com/owner/repo/tree/main',
        'https://github.com:8443/owner/repo',
        'https://github.com/owner/a%2Fb',
        'https://github.com/owner/repo%ZZ',
        '/tmp/local-remote.git',
        '../local-remote.git',
      ])
        assert.equal(describeOrigin(url).github, null, url);
      for (const url of [
        'javascript:alert(1)',
        'ext::some-helper',
        'not-a-remote-url',
      ]) {
        assert.equal(describeOrigin(url).url, null, url);
      }
    },
  );

  await t.test(
    'reads local configuration, preserves absence and applies insteadOf rules',
    async (r) => {
      const root = await mkdtemp(join(tmpdir(), 'pulsepit-origin-config-'));
      r.after(() => rm(root, { recursive: true, force: true }));
      await execute('git', ['init', '--initial-branch=main', root]);
      const git = (...args: string[]) => execute('git', args, { cwd: root });
      assert.deepEqual(await getOriginRemote(root), {
        origin: null,
        originError: null,
      });
      await git('config', 'url.https://github.com/.insteadOf', 'personal:');
      await git('remote', 'add', 'origin', 'personal:zeebha/pulsepit.git');
      // A different push URL does not change the fetch identity used for inspection.
      await git(
        'remote',
        'set-url',
        '--push',
        'origin',
        'git@gitlab.com:other/project.git',
      );
      const result = await getOriginRemote(root);
      assert.equal(result.originError, null);
      assert.equal(
        result.origin?.url,
        'https://github.com/zeebha/pulsepit.git',
      );
      assert.equal(result.origin?.github?.owner, 'zeebha');
    },
  );

  await t.test(
    'exposes origin in the repository list and through a targeted GET route',
    async (r) => {
      const root = await mkdtemp(join(tmpdir(), 'pulsepit-origin-api-'));
      const repository = join(root, 'repository');
      const empty = join(root, 'empty');
      await mkdir(repository);
      await mkdir(empty);
      await execute('git', ['init', '--initial-branch=main', repository]);
      await execute('git', ['init', '--initial-branch=main', empty]);
      await execute(
        'git',
        [
          'remote',
          'add',
          'origin',
          'https://user:private-test-token@github.com/zeebha/pulsepit.git',
        ],
        { cwd: repository },
      );
      const app = buildApp({ port: 3001, scanPaths: [root] });
      r.after(async () => {
        await app.close();
        await rm(root, { recursive: true, force: true });
      });
      const url = (path: string) =>
        `/api/repositories/origin?${new URLSearchParams({ path })}`;
      const response = await app.inject({
        method: 'GET',
        url: url(repository),
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().origin.github.repo, 'pulsepit');
      assert.equal(response.json().originError, null);
      assert.ok(!response.body.includes('private-test-token'));
      const list = await app.inject({
        method: 'GET',
        url: '/api/repositories',
      });
      assert.equal(list.statusCode, 200);
      const repos = list.json().repositories;
      assert.equal(
        repos.find((repo: { path: string }) => repo.path === repository).origin
          .github.owner,
        'zeebha',
      );
      assert.equal(
        repos.find((repo: { path: string }) => repo.path === empty).origin,
        null,
      );
      assert.ok(!list.body.includes('private-test-token'));
      for (const target of ['/api/repositories/origin', url(''), url(' ')]) {
        assert.equal(
          (await app.inject({ method: 'GET', url: target })).statusCode,
          400,
        );
      }
      assert.equal(
        (await app.inject({ method: 'GET', url: url(root) })).statusCode,
        404,
      );
    },
  );

  await t.test(
    'distinguishes an unreadable Git repository from a missing origin',
    async (r) => {
      const root = await mkdtemp(join(tmpdir(), 'pulsepit-origin-invalid-'));
      r.after(() => rm(root, { recursive: true, force: true }));
      const result = await getOriginRemote(root);
      assert.equal(result.origin, null);
      assert.equal(
        result.originError,
        'Unable to read origin for this repository.',
      );
    },
  );
});
