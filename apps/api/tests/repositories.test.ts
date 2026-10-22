import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { findConfiguredRepository } from '../src/services/repositories/repositories.service.js';

test('configured repository lookup without enriched scanning', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-lookup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scanPath = join(root, 'projects');
  const repository = join(scanPath, 'repository with spaces');
  const sibling = join(scanPath, 'sibling');
  const worktree = join(scanPath, 'worktree');
  const outside = join(root, 'outside');
  const nested = join(repository, 'nested');
  for (const path of [repository, sibling, outside, nested]) {
    await mkdir(join(path, '.git'), { recursive: true });
  }
  await mkdir(worktree);
  await writeFile(join(worktree, '.git'), 'gitdir: /unused/worktree\n');
  const paths = [join(root, 'missing-scan-path'), scanPath];

  await t.test('accepts direct repositories and normalizes paths', async () => {
    assert.deepEqual(
      await findConfiguredRepository(join(repository, '.'), paths),
      {
        name: 'repository with spaces',
        path: repository,
      },
    );
    assert.deepEqual(await findConfiguredRepository(`${repository}/`, paths), {
      name: 'repository with spaces',
      path: repository,
    });
    assert.equal(
      (await findConfiguredRepository(worktree, paths))?.path,
      worktree,
    );
    assert.equal(
      (await findConfiguredRepository(repository, [resolve(scanPath, '.')]))
        ?.path,
      repository,
    );
  });

  await t.test(
    'rejects outside, nested, missing and non-repository paths',
    async () => {
      const plain = join(scanPath, 'plain');
      await mkdir(plain);
      const file = join(scanPath, 'file');
      await writeFile(file, 'not a directory');
      for (const path of [
        outside,
        nested,
        scanPath,
        plain,
        file,
        join(scanPath, 'missing'),
      ]) {
        assert.equal(await findConfiguredRepository(path, paths), null, path);
      }
    },
  );

  await t.test(
    'rejects directory symlinks and symlinked Git markers',
    async () => {
      const link = join(scanPath, 'linked-repository');
      await symlink(outside, link, 'dir');
      assert.equal(await findConfiguredRepository(link, paths), null);
      const linkedGit = join(scanPath, 'linked-git');
      await mkdir(linkedGit);
      await symlink(join(outside, '.git'), join(linkedGit, '.git'), 'dir');
      assert.equal(await findConfiguredRepository(linkedGit, paths), null);
    },
  );

  await t.test(
    'routes only run the operation requested for the selected repository',
    async (r) => {
      const bin = join(root, 'bin');
      const log = join(root, 'git-calls.log');
      await mkdir(bin);
      await writeFile(log, '');
      await writeFile(
        join(bin, 'git'),
        `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = show ]; then
  printf '%s\\n' '{"name":"selected","version":"1.2.3"}'
else
  exit 7
fi
`,
        { mode: 0o755 },
      );
      const previousPath = process.env.PATH;
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      const app = buildApp({ port: 3001, scanPaths: paths });
      r.after(async () => {
        await app.close();
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      });

      const diagnostic = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: repository },
      });
      // No manifest means no detected package manager; validation itself runs no Git.
      assert.equal(diagnostic.statusCode, 422);
      assert.equal(await readFile(log, 'utf8'), '');

      const manifest = await app.inject({
        method: 'GET',
        url: `/api/repositories/package?${new URLSearchParams({ path: repository })}`,
      });
      assert.equal(manifest.statusCode, 200);
      assert.equal(manifest.json().manifest.version, '1.2.3');
      assert.equal(await readFile(log, 'utf8'), 'show HEAD:package.json\n');

      for (const path of [
        outside,
        nested,
        join(scanPath, 'linked-repository'),
      ]) {
        const invalidDiagnostic = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload: { path },
        });
        const invalidManifest = await app.inject({
          method: 'GET',
          url: `/api/repositories/package?${new URLSearchParams({ path })}`,
        });
        assert.equal(invalidDiagnostic.statusCode, 404);
        assert.equal(invalidManifest.statusCode, 404);
      }
      assert.equal(await readFile(log, 'utf8'), 'show HEAD:package.json\n');
    },
  );
});
