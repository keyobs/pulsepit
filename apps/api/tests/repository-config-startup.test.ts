import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test('API startup isolates a malformed repository while preserving health, healthy repositories and local diagnostics', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-config-startup-'));
  const scan = join(root, 'projects');
  const good = join(scan, 'good');
  const bad = join(scan, 'bad');
  const file = join(root, 'config.json');
  for (const path of [good, bad]) {
    await mkdir(join(path, '.git'), { recursive: true });
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({
        devDependencies: { '@keyobs/pulsepit-beacon': '0.1.1' },
      }),
    );
  }
  const environment = {
    label: 'Production',
    branch: 'main',
    url: 'https://app.example.invalid/',
    hosting: null,
    metadata: {
      type: 'static',
      url: 'https://metadata.example.invalid/pulsepit-deployment.json',
    },
  };
  await writeFile(
    file,
    JSON.stringify({
      repositories: {
        [good]: { deployments: { production: environment } },
        [bad]: {
          deployments: {
            production: {
              ...environment,
              metadata: {
                type: 'static',
                url: 'https://user:private-secret@example.invalid',
              },
            },
          },
        },
      },
    }),
  );

  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        PORT: String(port),
        SCAN_PATH: scan,
        CONFIG_PATH: file,
        GITHUB_TOKEN: '',
        VERCEL_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      await exit;
      clearTimeout(timer);
    }
    await rm(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}/api`;
  let healthy = false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(200),
      });
      if (response.ok) {
        assert.deepEqual(await response.json(), {
          status: 'ok',
          app: 'pulsepit-api',
        });
        healthy = true;
        break;
      }
    } catch {
      /* Startup may still be in progress. */
    }
    await delay(25);
  }
  assert.equal(
    healthy,
    true,
    'The API should start despite one invalid repository.',
  );
  const listing = await fetch(`${base}/repositories`);
  assert.equal(listing.status, 200);
  const data = await listing.json();
  assert.equal(data.repositories.length, 2);
  assert.deepEqual(
    data.repositories.find((entry: { path: string }) => entry.path === good)
      .urls,
    { production: environment.url },
  );
  assert.deepEqual(
    data.repositories.find((entry: { path: string }) => entry.path === bad)
      .urls,
    {},
  );
  const query = new URLSearchParams({ path: bad });
  const deployments = await fetch(`${base}/repositories/deployments?${query}`);
  assert.equal(deployments.status, 200);
  assert.deepEqual(await deployments.json(), { path: bad, environments: [] });
  const monitoring = await fetch(`${base}/repositories/monitoring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: bad }),
  });
  assert.equal(monitoring.status, 200);
  assert.equal((await monitoring.json()).configured, false);
  assert.ok(output.includes('INVALID_REPOSITORY_CONFIGURATION'));
  assert.equal(output.includes('private-secret'), false);
});
