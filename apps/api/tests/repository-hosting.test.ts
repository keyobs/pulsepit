import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import {
  loadRepositoryDeploymentConfig,
  loadRepositoryUrls,
} from '../src/services/repositories/repository-config.service.js';

test('hosting console links by repository and environment', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-hosting-'));
  const file = join(root, 'config.json');
  const projects = join(root, 'projects');
  const configured = join(projects, 'configured');
  const hostingOnly = join(projects, 'hosting-only');
  const empty = join(projects, 'empty');
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(data: unknown) {
    await writeFile(file, JSON.stringify(data));
  }

  await t.test(
    'defaults to empty maps when the file, section or hosting links are absent',
    async () => {
      assert.deepEqual(await loadRepositoryDeploymentConfig(file), {
        urls: {},
        hosting: {},
        environments: {},
      });
      await write({});
      assert.deepEqual(await loadRepositoryDeploymentConfig(file), {
        urls: {},
        hosting: {},
        environments: {},
      });
      await write({
        repositories: {
          [configured]: { urls: { production: 'https://app.example.invalid' } },
        },
      });
      const result = await loadRepositoryDeploymentConfig(file);
      assert.deepEqual(result.hosting, { [configured]: {} });
      assert.deepEqual(await loadRepositoryUrls(file), result.urls);
    },
  );

  await t.test(
    'normalizes hosting links independently of monitored environments',
    async () => {
      await write({
        repositories: {
          [`${configured}/.`]: {
            urls: { production: 'https://app.example.invalid/health' },
            hosting: {
              staging: 'https://CONSOLE.example.invalid/projects/app',
            },
          },
        },
      });
      assert.deepEqual(await loadRepositoryDeploymentConfig(file), {
        urls: {
          [configured]: { production: 'https://app.example.invalid/health' },
        },
        hosting: {
          [configured]: {
            staging: 'https://console.example.invalid/projects/app',
          },
        },
        environments: {
          [configured]: [
            {
              environment: 'production',
              label: 'Production',
              branch: null,
              url: 'https://app.example.invalid/health',
              hosting: null,
            },
            {
              environment: 'staging',
              label: 'Test',
              branch: null,
              url: null,
              hosting: {
                label: 'Example',
                url: 'https://console.example.invalid/projects/app',
              },
            },
          ],
        },
      });
    },
  );

  await t.test(
    'rejects malformed console links without including credentials in errors',
    async () => {
      for (const hosting of [
        null,
        [],
        'https://example.invalid',
        { production: '' },
        { ' ': 'https://example.invalid' },
        { production: '/relative' },
        { production: 'javascript:alert(1)' },
        { production: 42 },
        { production: 'https://user:secret-password@example.invalid' },
      ]) {
        await write({ repositories: { [configured]: { hosting } } });
        await assert.rejects(
          loadRepositoryDeploymentConfig(file),
          (error: Error) => {
            assert.match(error.message, /hosting/);
            assert.ok(!error.message.includes('secret-password'));
            return true;
          },
        );
      }
    },
  );

  await t.test(
    'exposes links for discovered repositories and excludes them from monitoring',
    async (r) => {
      for (const path of [configured, hostingOnly, empty]) {
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
            hosting: {
              production: 'https://console.example.invalid/projects/app',
            },
          },
          [hostingOnly]: {
            hosting: {
              staging: 'https://console.example.invalid/projects/staging',
            },
          },
          [join(root, 'outside')]: {
            hosting: { production: 'https://console.example.invalid/outside' },
          },
        },
      });
      const settings = await loadRepositoryDeploymentConfig(file);
      const app = buildApp(
        { port: 3001, scanPaths: [projects] },
        settings.urls,
        settings.hosting,
      );
      r.after(() => app.close());
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories',
      });
      assert.equal(response.statusCode, 200);
      const repositories = response.json().repositories;
      assert.equal(repositories.length, 3);
      assert.deepEqual(
        repositories.find((repo: { path: string }) => repo.path === configured)
          .hosting,
        { production: 'https://console.example.invalid/projects/app' },
      );
      assert.deepEqual(
        repositories.find((repo: { path: string }) => repo.path === configured)
          .urls,
        { production: 'https://app.example.invalid/health' },
      );
      assert.deepEqual(
        repositories.find((repo: { path: string }) => repo.path === empty)
          .hosting,
        {},
      );
      const monitoring = await app.inject({
        method: 'POST',
        url: '/api/repositories/monitoring',
        payload: { path: hostingOnly },
      });
      assert.deepEqual(monitoring.json(), {
        path: hostingOnly,
        configured: false,
        checks: [],
      });
    },
  );
});
