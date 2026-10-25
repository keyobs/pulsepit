import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  ErrorResponse,
  OutdatedResponse,
  RegistryDiagnosticCode,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { registryDiagnostic } from '../src/services/packages/registry-diagnostic.service.js';

type Case = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  versionFail?: boolean;
};
const secret = 'private-token-do-not-expose';
const privateUrl = `https://user:${secret}@private-registry.invalid/package?token=${secret}`;
const packet = (value: unknown) => JSON.stringify(value);
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-registry-rate-limit-'));
  const path = join(root, 'project');
  const bin = join(root, 'bin');
  await mkdir(join(path, '.git'), { recursive: true });
  await mkdir(bin);
  const previousPath = process.env.PATH;
  const script = join(bin, 'manager.cjs');
  await writeFile(
    script,
    `
const fs=require('node:fs');const fixture=JSON.parse(fs.readFileSync('fixture.json','utf8'));const args=process.argv.slice(2);
if(args[0]==='--version'&&!fixture.versionFail)fs.writeSync(1,fixture.modern?'4.9.2':'1.22.22');
else if(args[0]==='info')fs.writeSync(1,JSON.stringify({value:'project@workspace:.',children:{Dependencies:[{descriptor:'library@npm:^1',locator:'library@npm:1'}]}}));
else{fs.writeSync(1,fixture.stdout??'');fs.writeSync(2,fixture.stderr??'');process.exitCode=fixture.exitCode??1;}
`,
  );
  for (const manager of ['npm', 'pnpm', 'yarn'])
    await writeFile(
      join(bin, manager),
      `#!/bin/sh\nunset NODE_TEST_CONTEXT\nexec "${process.execPath}" "${script}" "$@"\n`,
      { mode: 0o755 },
    );
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  const app = buildApp({ port: 3001, scanPaths: [root] });
  app.log.level = 'silent';
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const diagnose = async (
    manager: 'npm' | 'pnpm' | 'classic' | 'modern',
    value: Case,
  ) => {
    await writeFile(
      join(path, 'package.json'),
      packet({
        packageManager: `${['classic', 'modern'].includes(manager) ? 'yarn' : manager}@1.0.0`,
      }),
    );
    await writeFile(
      join(path, 'fixture.json'),
      packet({ ...value, modern: manager === 'modern' }),
    );
    return app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path },
    });
  };
  return { path, diagnose };
}
function assertPrivate(body: string) {
  for (const text of [
    secret,
    'private-registry.invalid',
    'Authorization',
    'Bearer',
  ])
    assert.equal(body.includes(text), false);
}

test('all package managers expose registry rate limiting without inventing a retry deadline', async (t) => {
  const { path, diagnose } = await fixture(t);
  for (const [manager, value] of [
    [
      'npm',
      { stdout: packet({ error: { code: 'E429', summary: privateUrl } }) },
    ],
    ['npm', { stderr: `npm error code E429\n${privateUrl}` }],
    [
      'pnpm',
      {
        stdout: `[ERR_PNPM_FETCH_429] GET ${privateUrl}`,
        stderr: 'Retry-After: 60',
      },
    ],
    [
      'classic',
      {
        stderr: packet({
          type: 'error',
          data: `${privateUrl}: Request failed "429 Too Many Requests"`,
        }),
      },
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 35,
          data: 'Response Code: 429 (Too Many Requests)',
        }),
        exitCode: 0,
      },
    ],
    ['modern', { stderr: '➤ YN0035: Response Code: 429 (Too Many Requests)' }],
  ] as const) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().path, path);
    assert.equal(
      RegistryDiagnosticCode.parse(ErrorResponse.parse(response.json()).code),
      'REGISTRY_RATE_LIMITED',
    );
    assert.equal(response.json().resetAt, undefined);
    assert.equal(OutdatedResponse.safeParse(response.json()).success, false);
    assertPrivate(response.body);
  }
});

test('Retry-After on the same structured error becomes a canonical deadline through npm, pnpm and both Yarn paths', async (t) => {
  const observedAt = Date.parse('2026-10-24T12:00:00.000Z');
  t.mock.method(Date, 'now', () => observedAt);
  const date = new Date(observedAt + 120_000).toUTCString();
  for (const [manager, error, expected] of [
    [
      'npm',
      {
        error: {
          code: 'E429',
          headers: { 'retry-after': '60', Authorization: `Bearer ${secret}` },
        },
      },
      observedAt + 60_000,
    ],
    [
      'pnpm',
      {
        code: 'ERR_PNPM_FETCH_429',
        headers: { 'Retry-After': date },
        message: privateUrl,
      },
      observedAt + 120_000,
    ],
    [
      'classic',
      {
        type: 'error',
        data: `${privateUrl}: Request failed "429 Too Many Requests"`,
        headers: { 'RETRY-AFTER': '0' },
      },
      observedAt,
    ],
    [
      'modern',
      {
        type: 'error',
        name: 35,
        data: 'Response Code: 429 (Too Many Requests)',
        headers: { 'retry-after': date },
      },
      observedAt + 120_000,
    ],
  ] as const) {
    // Each manager must run independently of another manager's active deadline.
    await t.test(manager, async (t) => {
      const { diagnose } = await fixture(t);
      const response = await diagnose(manager, { stdout: packet(error) });
      assert.equal(response.statusCode, 502);
      assert.equal(response.json().code, 'REGISTRY_RATE_LIMITED');
      assert.equal(
        ErrorResponse.parse(response.json()).resetAt,
        new Date(expected).toISOString(),
      );
      assertPrivate(response.body);
      assert.equal(response.body.includes('retry-after'), false);
    });
  }
});

test('invalid or unrelated retry hints are ignored and incidental 429 strings do not change successful reports or other errors', async (t) => {
  const { diagnose } = await fixture(t);
  const observedAt = Date.parse('2026-10-24T12:00:00.000Z');
  t.mock.method(Date, 'now', () => observedAt);
  for (const headers of [
    {},
    { 'retry-after': '-1' },
    { 'retry-after': '1.5' },
    { 'retry-after': '9'.repeat(30) },
    { 'retry-after': '60\r\nprivate-header' },
    { 'retry-after': privateUrl },
    { 'retry-after': ['60'] },
    { 'retry-after': '60', 'Retry-After': '120' },
    { 'retry-after': new Date(observedAt - 1000).toUTCString() },
    { 'retry-after': 'Mon, 31 Feb 2026 12:00:00 GMT' },
  ]) {
    const response = await diagnose('npm', {
      stdout: packet({ error: { code: 'E429', headers } }),
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().code, 'REGISTRY_RATE_LIMITED');
    assert.equal(response.json().resetAt, undefined);
    assertPrivate(response.body);
  }
  const response = await diagnose('npm', {
    stdout: packet({ E429: { current: '429', wanted: '500', latest: '503' } }),
    exitCode: 0,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    OutdatedResponse.parse(response.json()).dependencies[0].name,
    'E429',
  );
  const auth = registryDiagnostic(
    'npm',
    packet({ error: { code: 'E401', headers: { 'retry-after': '60' } } }),
    '',
    true,
  );
  assert.equal(auth?.code, 'REGISTRY_AUTHENTICATION_FAILED');
  assert.equal(auth?.resetAt, undefined);
  assert.equal(
    registryDiagnostic(
      'npm',
      packet({ error: { code: 'E404', summary: 'E429' } }),
      '',
      true,
    ),
    null,
  );
  assert.equal(
    registryDiagnostic(
      'yarn',
      packet({
        type: 'warning',
        name: 35,
        data: 'Response Code: 429 (Too Many Requests)',
      }),
      '',
      true,
    ),
    null,
  );
});
