import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { findWorkflowFiles } from '../src/services/workflows.service.js';

test('discover workflow files on disk', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-workflows-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function repository(name: string) {
    const path = join(root, name);
    await mkdir(join(path, '.git'), { recursive: true });
    return path;
  }

  await t.test(
    'returns an empty result when no workflow paths exist',
    async () => {
      assert.deepEqual(await findWorkflowFiles(await repository('empty')), {
        workflows: [],
        errors: [],
      });
    },
  );

  await t.test(
    'detects direct YAML workflow files and GitLab without requiring commits',
    async () => {
      const path = await repository('both');
      const github = join(path, '.github/workflows');
      await mkdir(join(github, 'nested'), { recursive: true });
      await mkdir(join(github, 'directory.yml'));
      for (const file of [
        'z-deploy.yaml',
        'a-ci.yml',
        'notes.md',
        'ci.yml.bak',
        'nested/ignored.yml',
      ]) {
        await writeFile(join(github, file), 'Not parsed in this step.');
      }
      await writeFile(join(path, '.gitlab-ci.yml'), 'stages: [test]');
      await writeFile(
        join(path, 'custom-pipeline.yml'),
        'Not a default workflow path.',
      );
      assert.deepEqual(await findWorkflowFiles(path), {
        workflows: [
          { provider: 'github-actions', file: '.github/workflows/a-ci.yml' },
          {
            provider: 'github-actions',
            file: '.github/workflows/z-deploy.yaml',
          },
          { provider: 'gitlab-ci', file: '.gitlab-ci.yml' },
        ],
        errors: [],
      });
    },
  );

  await t.test('does not follow symlinked GitHub directories', async () => {
    const outside = join(root, 'external-workflows');
    await mkdir(outside);
    await writeFile(join(outside, 'external.yml'), 'name: External');
    for (const target of ['.github', '.github/workflows']) {
      const path = await repository(
        target === '.github' ? 'linked-parent' : 'linked-directory',
      );
      if (target !== '.github') await mkdir(join(path, '.github'));
      await symlink(outside, join(path, target), 'dir');
      const result = await findWorkflowFiles(path);
      assert.deepEqual(result.workflows, []);
      assert.equal(result.errors[0].path, target);
      assert.equal(result.errors[0].code, 'UNSUPPORTED_PATH');
    }
  });

  await t.test(
    'does not report symlinked workflow files as regular workflows',
    async () => {
      const path = await repository('linked-files');
      await mkdir(join(path, '.github/workflows'), { recursive: true });
      const external = join(root, 'external.yml');
      await writeFile(external, 'name: External');
      await symlink(external, join(path, '.github/workflows/linked.yml'));
      await symlink(external, join(path, '.gitlab-ci.yml'));
      const result = await findWorkflowFiles(path);
      assert.deepEqual(result.workflows, []);
      assert.equal(result.errors.length, 2);
      assert.ok(
        result.errors.every((error) => error.code === 'UNSUPPORTED_PATH'),
      );
    },
  );

  await t.test(
    'keeps GitLab results when the GitHub path cannot be inspected as a directory',
    async () => {
      const path = await repository('partial');
      await writeFile(join(path, '.github'), 'Not a directory.');
      await writeFile(join(path, '.gitlab-ci.yml'), 'stages: [test]');
      const result = await findWorkflowFiles(path);
      assert.deepEqual(result.workflows, [
        { provider: 'gitlab-ci', file: '.gitlab-ci.yml' },
      ]);
      assert.equal(result.errors[0].path, '.github');
    },
  );

  await t.test(
    'validates repository paths and exposes discovery through GET /workflows',
    async (r) => {
      const path = await repository('api');
      await writeFile(join(path, '.gitlab-ci.yml'), 'stages: [test]');
      const app = buildApp({ port: 3001, scanPaths: [root] });
      r.after(() => app.close());
      const url = (path: string) =>
        `/api/repositories/workflows?${new URLSearchParams({ path })}`;
      const response = await app.inject({ method: 'GET', url: url(path) });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        path,
        workflows: [{ provider: 'gitlab-ci', file: '.gitlab-ci.yml' }],
        errors: [],
      });
      for (const target of ['/api/repositories/workflows', url(''), url(' ')]) {
        assert.equal(
          (await app.inject({ method: 'GET', url: target })).statusCode,
          400,
        );
      }
      for (const target of [root, join(root, 'missing'), join(path, '.git')]) {
        assert.equal(
          (await app.inject({ method: 'GET', url: url(target) })).statusCode,
          404,
        );
      }
      const partial = await app.inject({
        method: 'GET',
        url: url(join(root, 'partial')),
      });
      assert.equal(partial.statusCode, 200);
      assert.equal(partial.json().workflows.length, 1);
      assert.equal(partial.json().errors.length, 1);
    },
  );
});
