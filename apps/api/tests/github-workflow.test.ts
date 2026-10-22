import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import {
  analyzeGithubWorkflow,
  parseGithubWorkflow,
} from '../src/services/workflows/github-workflow.service.js';

const jobs =
  '\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n';
const file = '.github/workflows/ci.yml';

test('GitHub Actions metadata analysis', async (t) => {
  await t.test('extracts events and keeps branch filters per event', () => {
    const result = parseGithubWorkflow(
      `name: Build and test
on:
  push:
    branches: [main, 'releases/**', '!releases/old/**']
  pull_request:
    branches-ignore: [legacy]
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * *'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
  reusable:
    uses: owner/repo/.github/workflows/reuse.yml@main
`,
      file,
    );
    assert.equal(result.analysisError, null);
    assert.deepEqual(result.analysis, {
      name: 'Build and test',
      on: ['push', 'pull_request', 'workflow_dispatch', 'schedule'],
      branches: ['main', 'releases/**', '!releases/old/**'],
      branchFilters: {
        push: {
          include: ['main', 'releases/**', '!releases/old/**'],
          exclude: [],
        },
        pull_request: { include: [], exclude: ['legacy'] },
      },
      jobs: ['build', 'reusable'],
      environments: [],
      deployment: {
        status: 'unknown',
        evidence: [
          {
            job: 'reusable',
            source: 'reusable_workflow',
            confidence: 'unknown',
            message: 'The reusable workflow content has not been inspected.',
          },
        ],
      },
    });
  });

  await t.test(
    'handles scalar and array on syntax and falls back to the file name',
    () => {
      for (const [source, events] of [
        ['on: push', ['push']],
        ['on: [push, pull_request]', ['push', 'pull_request']],
      ] as const) {
        const result = parseGithubWorkflow(source + jobs, file);
        assert.equal(result.analysisError, null);
        assert.deepEqual(result.analysis?.on, events);
        assert.equal(result.analysis?.name, file);
        assert.deepEqual(result.analysis?.branchFilters, {});
      }
    },
  );

  await t.test('supports YAML anchors without executing job commands', () => {
    const result = parseGithubWorkflow(
      `on: push
template: &job
  runs-on: ubuntu-latest
  steps:
    - run: exit 99
jobs:
  first: *job
  second: *job
`,
      file,
    );
    assert.equal(result.analysisError, null);
    assert.deepEqual(result.analysis?.jobs, ['first', 'second']);
  });

  await t.test(
    'reports malformed YAML, duplicate keys and unsupported tags',
    () => {
      for (const content of [
        'on: [',
        `name: First\nname: Second\non: push${jobs}`,
        `on: !custom push${jobs}`,
        `on: push\n---\non: pull_request${jobs}`,
      ]) {
        const result = parseGithubWorkflow(content, file);
        assert.equal(result.analysis, null);
        assert.equal(result.analysisError?.code, 'INVALID_YAML');
      }
    },
  );

  await t.test(
    'reports invalid structures instead of silently returning empty metadata',
    () => {
      for (const content of [
        '',
        '[]',
        'on: push',
        `on: []${jobs}`,
        `name: 42\non: push${jobs}`,
        `on:\n  push: 42${jobs}`,
        `on:\n  push:\n    branches: main${jobs}`,
        'on:\n  push:\n    branches: [main]\n    branches-ignore: [legacy]' +
          jobs,
        'on: push\njobs:\n  build: not-a-job',
      ]) {
        const result = parseGithubWorkflow(content, file);
        assert.equal(result.analysis, null);
        assert.equal(result.analysisError?.code, 'INVALID_WORKFLOW', content);
      }
    },
  );

  await t.test('bounds YAML alias expansion', () => {
    const aliases = Array.from({ length: 200 }, () => '*base').join(', ');
    const result = parseGithubWorkflow(
      `on: push\nbase: &base [a, b, c, d, e, f, g, h, i, j]\nrepeated: [${aliases}]${jobs}`,
      file,
    );
    assert.equal(result.analysisError?.code, 'INVALID_YAML');
  });

  await t.test(
    'limits file size and refuses missing or symlinked files',
    async (r) => {
      const root = await mkdtemp(join(tmpdir(), 'pulsepit-github-files-'));
      r.after(() => rm(root, { recursive: true, force: true }));
      await writeFile(
        join(root, 'large.yml'),
        Buffer.alloc(1024 * 1024 + 1, 'a'),
      );
      await writeFile(join(root, 'regular.yml'), `on: push${jobs}`);
      await symlink(join(root, 'regular.yml'), join(root, 'linked.yml'));
      assert.equal(
        (await analyzeGithubWorkflow(root, 'large.yml')).analysisError?.code,
        'FILE_TOO_LARGE',
      );
      assert.equal(
        (await analyzeGithubWorkflow(root, 'linked.yml')).analysisError?.code,
        'READ_FAILED',
      );
      assert.equal(
        (await analyzeGithubWorkflow(root, 'missing.yml')).analysisError?.code,
        'READ_FAILED',
      );
      assert.equal(
        (await analyzeGithubWorkflow(root, 'regular.yml')).analysisError,
        null,
      );
    },
  );

  await t.test(
    'returns valid and invalid workflow files together through the API',
    async (r) => {
      const root = await mkdtemp(join(tmpdir(), 'pulsepit-github-route-'));
      const repository = join(root, 'repository');
      await mkdir(join(repository, '.git'), { recursive: true });
      await mkdir(join(repository, '.github/workflows'), { recursive: true });
      await writeFile(join(repository, file), `name: CI\non: push${jobs}`);
      await writeFile(
        join(repository, '.github/workflows/broken.yml'),
        'on: [',
      );
      await writeFile(
        join(repository, '.github/workflows/large.yaml'),
        Buffer.alloc(1024 * 1024 + 1, 'a'),
      );
      await writeFile(join(repository, '.gitlab-ci.yml'), 'stages: [test]');
      const app = buildApp({ port: 3001, scanPaths: [root] });
      r.after(async () => {
        await app.close();
        await rm(root, { recursive: true, force: true });
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/repositories/workflows?${new URLSearchParams({ path: repository })}`,
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.workflows.length, 4);
      assert.deepEqual(body.errors, []);
      assert.equal(
        body.workflows.find(
          (workflow: { file: string }) => workflow.file === file,
        ).analysis.name,
        'CI',
      );
      assert.equal(
        body.workflows.find((workflow: { file: string }) =>
          workflow.file.endsWith('broken.yml'),
        ).analysisError.code,
        'INVALID_YAML',
      );
      assert.equal(
        body.workflows.find((workflow: { file: string }) =>
          workflow.file.endsWith('large.yaml'),
        ).analysisError.code,
        'FILE_TOO_LARGE',
      );
      assert.deepEqual(
        body.workflows.find(
          (workflow: { provider: string }) => workflow.provider === 'gitlab-ci',
        ),
        { provider: 'gitlab-ci', file: '.gitlab-ci.yml' },
      );
    },
  );
});
