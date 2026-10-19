import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('repository route registration after grouping by HTTP method', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-route-registration-'));
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  await t.test(
    'GET /api/repositories keeps its exact URL and response',
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories',
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        scanPaths: [root],
        repositories: [],
        scanErrors: [],
      });
    },
  );

  await t.test(
    'GET /api/repositories/package keeps query validation and repository checks',
    async () => {
      const invalid = await app.inject({
        method: 'GET',
        url: '/api/repositories/package',
      });
      assert.equal(invalid.statusCode, 400);
      const unknown = await app.inject({
        method: 'GET',
        url: `/api/repositories/package?${new URLSearchParams({ path: join(root, 'unknown') })}`,
      });
      assert.equal(unknown.statusCode, 404);
      assert.equal(
        unknown.json().error,
        'Repository not found in configured scan directories.',
      );
    },
  );

  for (const action of ['fetch', 'outdated']) {
    await t.test(
      `POST /api/repositories/${action} keeps body validation and repository checks`,
      async () => {
        const url = `/api/repositories/${action}`;
        const invalid = await app.inject({ method: 'POST', url, payload: {} });
        assert.equal(invalid.statusCode, 400);
        const unknown = await app.inject({
          method: 'POST',
          url,
          payload: { path: join(root, 'unknown') },
        });
        assert.equal(unknown.statusCode, 404);
        assert.equal(
          unknown.json().error,
          'Repository not found in configured scan directories.',
        );
      },
    );
  }
});
