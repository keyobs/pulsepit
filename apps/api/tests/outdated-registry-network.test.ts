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
const report = packet({ library: { current: '1', wanted: '2', latest: '3' } });
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-registry-network-'));
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

test('npm and pnpm expose DNS, connection, certificate, request timeout and server errors without private output', async (t) => {
  const { path, diagnose } = await fixture(t);
  const cases = [
    [
      'npm',
      { stdout: packet({ error: { code: 'ENOTFOUND', summary: privateUrl } }) },
      'REGISTRY_DNS_FAILED',
    ],
    [
      'npm',
      { stderr: `npm error code ECONNREFUSED\n${privateUrl}`, exitCode: 2 },
      'REGISTRY_CONNECTION_FAILED',
    ],
    [
      'npm',
      { stderr: `npm ERR! code CERT_HAS_EXPIRED\n${privateUrl}` },
      'REGISTRY_TLS_FAILED',
    ],
    [
      'npm',
      { stdout: packet({ error: { code: 'ETIMEDOUT', summary: privateUrl } }) },
      'REGISTRY_REQUEST_TIMEOUT',
    ],
    [
      'npm',
      { stdout: packet({ error: { code: 'E503', summary: privateUrl } }) },
      'REGISTRY_UNAVAILABLE',
    ],
    [
      'pnpm',
      {
        stdout: `[ERR_PNPM_META_FETCH_FAIL] GET ${privateUrl}: request failed, reason: getaddrinfo ENOTFOUND private-host`,
      },
      'REGISTRY_DNS_FAILED',
    ],
    [
      'pnpm',
      { stderr: ` ECONNRESET  GET ${privateUrl}`, stdout: report },
      'REGISTRY_CONNECTION_FAILED',
    ],
    [
      'pnpm',
      {
        stdout: packet({
          error: {
            code: 'ERR_PNPM_META_FETCH_FAIL',
            cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' },
            message: privateUrl,
          },
        }),
      },
      'REGISTRY_TLS_FAILED',
    ],
    [
      'pnpm',
      {
        stdout: `[ERR_PNPM_META_FETCH_FAIL] GET ${privateUrl}: request failed, reason: ESOCKETTIMEDOUT`,
      },
      'REGISTRY_REQUEST_TIMEOUT',
    ],
    [
      'pnpm',
      { stderr: `[ERR_PNPM_FETCH_502] GET ${privateUrl}` },
      'REGISTRY_UNAVAILABLE',
    ],
  ] as const;
  for (const [manager, value, code] of cases) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502, response.body);
    assert.equal(response.json().path, path);
    assert.equal(
      RegistryDiagnosticCode.parse(ErrorResponse.parse(response.json()).code),
      code,
    );
    assert.equal(OutdatedResponse.safeParse(response.json()).success, false);
    assertPrivate(response.body);
  }
});

test('Classic and Modern recognize network details and HTTP server errors in JSON or text', async (t) => {
  const { diagnose } = await fixture(t);
  const cases = [
    [
      'classic',
      {
        stderr: packet({
          type: 'error',
          data: `${privateUrl}: getaddrinfo EAI_AGAIN private-host`,
        }),
      },
      'REGISTRY_DNS_FAILED',
    ],
    [
      'classic',
      {
        stdout: packet({
          type: 'error',
          data: `${privateUrl}: connect ECONNREFUSED private-address`,
        }),
      },
      'REGISTRY_CONNECTION_FAILED',
    ],
    [
      'classic',
      {
        stderr: packet({
          type: 'error',
          data: `${privateUrl}: self signed certificate`,
        }),
      },
      'REGISTRY_TLS_FAILED',
    ],
    [
      'classic',
      {
        stderr: packet({
          type: 'error',
          data: `${privateUrl}: ESOCKETTIMEDOUT`,
        }),
      },
      'REGISTRY_REQUEST_TIMEOUT',
    ],
    [
      'classic',
      {
        stdout: packet({
          type: 'error',
          data: `${privateUrl}: Request failed "503 Service Unavailable"`,
        }),
      },
      'REGISTRY_UNAVAILABLE',
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 35,
          data: ' getaddrinfo ENOTFOUND private-host',
        }),
      },
      'REGISTRY_DNS_FAILED',
    ],
    [
      'modern',
      { stdout: packet({ type: 'error', name: 35, data: 'read ECONNRESET' }) },
      'REGISTRY_CONNECTION_FAILED',
    ],
    [
      'modern',
      { stderr: '➤ YN0035: certificate has expired' },
      'REGISTRY_TLS_FAILED',
    ],
    [
      'modern',
      {
        stdout: packet({ type: 'error', name: 35, data: 'request ETIMEDOUT' }),
      },
      'REGISTRY_REQUEST_TIMEOUT',
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 35,
          data: '  Response Code: 504 (Gateway Timeout)',
        }),
        exitCode: 0,
      },
      'REGISTRY_UNAVAILABLE',
    ],
  ] as const;
  for (const [manager, value, code] of cases) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502, response.body);
    assert.equal(response.json().code, code);
    assertPrivate(response.body);
  }
});

test('incidental network words, warnings, package names and unrelated errors are not misclassified; auth codes remain distinct', async (t) => {
  const { diagnose } = await fixture(t);
  for (const manager of ['npm', 'pnpm'] as const) {
    const response = await diagnose(manager, {
      stdout: packet({
        ENOTFOUND: { current: '500', wanted: '503', latest: '504' },
      }),
      exitCode: 0,
      stderr: 'npm error code ETIMEDOUT',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      OutdatedResponse.parse(response.json()).dependencies[0].name,
      'ENOTFOUND',
    );
  }
  for (const [manager, value, code] of [
    [
      'npm',
      { stdout: packet({ error: { code: 'EACCES', summary: 'ENOTFOUND' } }) },
      'INVALID_OUTPUT',
    ],
    [
      'pnpm',
      { stdout: `ERR_PNPM_FETCH_404 GET ${privateUrl}` },
      'INVALID_OUTPUT',
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 35,
          data: 'Response Code: 404 (Not Found)',
        }),
      },
      'COMMAND_FAILED',
    ],
    [
      'classic',
      {
        stderr: packet({
          type: 'error',
          data: `${privateUrl}: ENOENT private-path`,
        }),
      },
      'COMMAND_FAILED',
    ],
    [
      'npm',
      { stdout: packet({ error: { code: 'E401', summary: privateUrl } }) },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
    [
      'modern',
      { stdout: packet({ type: 'error', name: 41, data: privateUrl }) },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
  ] as const) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().code, code);
    assertPrivate(response.body);
  }
  assert.equal(
    registryDiagnostic('pnpm', 'WARN retrying ECONNRESET', '', true),
    null,
  );
  assert.equal(
    registryDiagnostic(
      'yarn',
      packet({
        type: 'warning',
        name: 35,
        data: 'Response Code: 503 (Unavailable)',
      }),
      '',
      true,
    ),
    null,
  );
  assert.equal(
    registryDiagnostic(
      'npm',
      packet({ error: { code: 'E404', summary: 'ECONNRESET' } }),
      '',
      true,
    ),
    null,
  );
  assert.equal(
    registryDiagnostic(
      'yarn',
      packet({ type: 'error', name: 35, data: privateUrl }),
      '',
      true,
    ),
    null,
  );
});
