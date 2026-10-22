import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { loadRepositoryUrls } from '../src/services/repositories/repository-config.service.js';

test('repository URL configuration', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-url-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'config.json');
  const projects = join(root, 'projects');
  const configured = join(projects, 'configured');
  const unconfigured = join(projects, 'unconfigured');
  async function write(data: unknown) {
    await writeFile(file, JSON.stringify(data));
  }

  await t.test(
    'treats an absent file or repositories section as empty settings',
    async () => {
      assert.deepEqual(await loadRepositoryUrls(file), {});
      await write({});
      assert.deepEqual(await loadRepositoryUrls(file), {});
      await write({ repositories: { [configured]: { name: 'Custom name' } } });
      assert.deepEqual(await loadRepositoryUrls(file), { [configured]: {} });
    },
  );

  await t.test(
    'loads and normalizes URLs keyed by absolute repository paths',
    async () => {
      await write({
        repositories: {
          [`${configured}/.`]: {
            urls: {
              production: 'https://APP.example.com',
              staging: 'http://localhost:8080/health',
            },
            hosting: { production: 'https://console.example.com' },
          },
        },
      });
      assert.deepEqual(await loadRepositoryUrls(file), {
        [configured]: {
          production: 'https://app.example.com/',
          staging: 'http://localhost:8080/health',
        },
      });
    },
  );

  await t.test(
    'rejects malformed files, relative paths and duplicate normalized paths',
    async () => {
      await writeFile(file, '{');
      await assert.rejects(loadRepositoryUrls(file), /Invalid JSON/);
      for (const data of [
        [],
        null,
        { repositories: [] },
        { repositories: { relative: {} } },
        { repositories: { [configured]: {}, [`${configured}/.`]: {} } },
        { repositories: { [configured]: null } },
      ]) {
        await write(data);
        await assert.rejects(loadRepositoryUrls(file));
      }
    },
  );

  await t.test(
    'rejects invalid URLs, non-HTTP schemes, credentials and invalid environments',
    async () => {
      for (const urls of [
        null,
        [],
        { production: '' },
        { production: 42 },
        { ' ': 'https://example.com' },
        { production: '/relative' },
        { production: 'ftp://example.com/file' },
        { production: 'https://user:password@example.com' },
      ]) {
        await write({ repositories: { [configured]: { urls } } });
        await assert.rejects(loadRepositoryUrls(file));
      }
      await assert.rejects(loadRepositoryUrls(root), /Unable to read/);
    },
  );

  await t.test(
    'resolves CONFIG_PATH and XDG_CONFIG_HOME through environment configuration',
    () => {
      assert.equal(
        readConfig({ SCAN_PATH: projects, CONFIG_PATH: file }).configPath,
        file,
      );
      assert.equal(
        readConfig({ SCAN_PATH: projects, XDG_CONFIG_HOME: root }).configPath,
        join(root, 'pulsepit', 'config.json'),
      );
      assert.throws(
        () => readConfig({ SCAN_PATH: projects, CONFIG_PATH: ' ' }),
        /CONFIG_PATH/,
      );
    },
  );

  await t.test(
    'exposes URLs only for discovered repositories, with empty defaults',
    async (r) => {
      for (const path of [configured, unconfigured]) {
        await mkdir(path, { recursive: true });
        await promisify(execFile)('git', [
          'init',
          '--initial-branch=main',
          path,
        ]);
      }
      await write({
        repositories: {
          [configured]: {
            urls: { production: 'https://app.example.invalid/health' },
          },
          [join(root, 'outside')]: {
            urls: { production: 'https://outside.example.invalid' },
          },
        },
      });
      const urls = await loadRepositoryUrls(file);
      const app = buildApp({ port: 3001, scanPaths: [projects] }, urls);
      r.after(() => app.close());
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories',
      });
      assert.equal(response.statusCode, 200);
      const repositories = response.json().repositories;
      assert.equal(repositories.length, 2);
      assert.deepEqual(
        repositories.find((repo: { path: string }) => repo.path === configured)
          .urls,
        { production: 'https://app.example.invalid/health' },
      );
      assert.deepEqual(
        repositories.find(
          (repo: { path: string }) => repo.path === unconfigured,
        ).urls,
        {},
      );
    },
  );
});
