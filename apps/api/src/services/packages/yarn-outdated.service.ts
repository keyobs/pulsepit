import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { RegistryDiagnosticCode } from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';
import type { OutdatedDependency, OutdatedResult } from './outdated.service.js';
import { registryDiagnostic } from './registry-diagnostic.service.js';

const execute = promisify(execFile);
type FailureCode =
  | RegistryDiagnosticCode
  | 'PACKAGE_MANAGER'
  | 'TIMEOUT'
  | 'COMMAND_FAILED'
  | 'INVALID_OUTPUT';

class DiagnosticError extends Error {
  constructor(
    public code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(output: string): Record<string, unknown>[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry: unknown = JSON.parse(line);
      if (!object(entry)) throw new Error('Invalid Yarn JSON.');
      return entry;
    });
}

function classicReport(
  path: string,
  stdout: string,
  stderr: string,
  code: number,
): OutdatedResult {
  const failure = () =>
    new DiagnosticError(
      'COMMAND_FAILED',
      'Yarn Classic dependency check failed. Verify registry access and the lockfile.',
    );
  for (const line of stderr.split('\n')) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (object(event) && event.type === 'error') throw failure();
  }
  const dependencies: OutdatedDependency[] = [];
  let tables = 0;
  for (const event of records(stdout)) {
    if (event.type === 'error') throw failure();
    if (
      ['info', 'warning', 'verbose', 'log', 'success'].includes(
        String(event.type),
      ) &&
      typeof event.data === 'string'
    )
      continue;
    if (
      event.type === 'finished' &&
      typeof event.data === 'number' &&
      Number.isFinite(event.data) &&
      event.data >= 0
    )
      continue;
    if (event.type !== 'table' || ++tables > 1 || !object(event.data))
      throw new Error('Invalid Yarn Classic event.');
    const { head, body } = event.data;
    if (
      !Array.isArray(head) ||
      !head.every((value) => typeof value === 'string') ||
      !Array.isArray(body)
    )
      throw new Error('Invalid Yarn Classic table.');
    const standalone = [
      'Package',
      'Current',
      'Wanted',
      'Latest',
      'Package Type',
      'URL',
    ];
    const workspace = [
      'Package',
      'Current',
      'Wanted',
      'Latest',
      'Workspace',
      'Package Type',
      'URL',
    ];
    const hasWorkspace = JSON.stringify(head) === JSON.stringify(workspace);
    if (!hasWorkspace && JSON.stringify(head) !== JSON.stringify(standalone))
      throw new Error('Unsupported Yarn Classic columns.');
    for (const row of body) {
      if (
        !Array.isArray(row) ||
        row.length !== head.length ||
        !row.every((value) => typeof value === 'string') ||
        row.slice(0, 4).some((value) => !value.trim())
      )
        throw new Error('Invalid Yarn Classic dependency.');
      dependencies.push({
        name: row[0],
        current: row[1],
        wanted: row[2],
        latest: row[3],
        dependent: hasWorkspace ? row[4] || null : null,
        location: hasWorkspace ? null : resolve(path),
      });
    }
  }
  if (code === 1 && dependencies.length === 0) throw failure();
  return {
    packageManager: 'yarn',
    dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)),
    error: null,
  };
}

export async function getYarnOutdatedDependencies(
  repositoryPath: string,
): Promise<OutdatedResult> {
  const deadline = Date.now() + 30_000;
  async function run(
    args: string[],
    outdated = false,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new DiagnosticError(
        'TIMEOUT',
        'Dependency check timed out after 30 seconds.',
      );
    try {
      const { stdout, stderr } = await execute('yarn', args, {
        cwd: repositoryPath,
        timeout: remaining,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        env: {
          ...createCommandEnvironment('package-manager'),
          YARN_ENABLE_SCRIPTS: 'false',
          COREPACK_ENABLE_NETWORK: '0',
        },
      });
      const registry = registryDiagnostic('yarn', stdout, stderr, false);
      if (registry) throw new DiagnosticError(registry.code, registry.error);
      return { stdout, stderr, code: 0 };
    } catch (error) {
      if (error instanceof DiagnosticError) throw error;
      const failure = error as {
        code?: string | number;
        signal?: string;
        stdout?: string;
        stderr?: string;
      };
      if (failure.signal === 'SIGKILL')
        throw new DiagnosticError(
          'TIMEOUT',
          'Dependency check timed out after 30 seconds.',
        );
      const registry = registryDiagnostic(
        'yarn',
        failure.stdout ?? '',
        failure.stderr ?? '',
        true,
      );
      if (registry) throw new DiagnosticError(registry.code, registry.error);
      if (outdated && failure.code === 1 && typeof failure.stdout === 'string')
        return {
          stdout: failure.stdout,
          stderr: failure.stderr ?? '',
          code: 1,
        };
      throw new DiagnosticError(
        'COMMAND_FAILED',
        failure.code === 'ENOENT'
          ? 'yarn executable was not found in PATH.'
          : 'Unable to run Yarn dependency check. Verify registry access, Yarn availability and the lockfile.',
      );
    }
  }

  try {
    const version = (await run(['--version'])).stdout.trim();
    const match = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(version);
    if (!match) throw new Error('Invalid Yarn version.');
    if (Number(match[1]) === 1) {
      const result = await run(
        ['outdated', '--json', '--ignore-scripts', '--non-interactive'],
        true,
      );
      return classicReport(
        repositoryPath,
        result.stdout,
        result.stderr,
        result.code,
      );
    }
    if (Number(match[1]) < 1) {
      throw new DiagnosticError(
        'PACKAGE_MANAGER',
        'This Yarn version is unsupported. Use Yarn Classic (1.x) or Yarn Modern (2 or later).',
      );
    }

    const nodes = records((await run(['info', '--all', '--json'])).stdout);
    if (nodes.length === 0)
      throw new Error('Missing Yarn project information.');
    const metadata = new Map<string, { name: string; version: string }>();
    async function info(query: string) {
      const cached = metadata.get(query);
      if (cached) return cached;
      const result = records(
        (
          await run([
            'npm',
            'info',
            query,
            '--fields',
            'name,version',
            '--json',
          ])
        ).stdout,
      );
      // Warnings about unmet ranges must not turn a fallback into "wanted".
      if (
        result.length !== 1 ||
        typeof result[0].name !== 'string' ||
        typeof result[0].version !== 'string'
      ) {
        throw new Error('Invalid Yarn registry information.');
      }
      const entry = { name: result[0].name, version: result[0].version };
      metadata.set(query, entry);
      return entry;
    }

    const dependencies: OutdatedDependency[] = [];
    let workspaces = 0;
    for (const node of nodes) {
      if (typeof node.value !== 'string' || !object(node.children))
        throw new Error('Invalid Yarn package information.');
      const workspace = /^(.+)@workspace:(.*)$/.exec(node.value);
      if (!workspace) continue;
      workspaces++;
      const entries = node.children.Dependencies ?? [];
      if (!Array.isArray(entries))
        throw new Error('Invalid Yarn dependencies.');
      for (const entry of entries) {
        if (
          !object(entry) ||
          typeof entry.descriptor !== 'string' ||
          (entry.locator !== null && typeof entry.locator !== 'string')
        ) {
          throw new Error('Invalid Yarn resolution.');
        }
        const descriptor = /^(.+)@npm:(.+)$/.exec(entry.descriptor);
        // Local workspaces, Git, file, portal and other non-registry protocols
        // have no published version to compare against.
        if (!descriptor) continue;
        const [, name, range] = descriptor;
        const alias = /^((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(range);
        const registryName = alias?.[1] ?? name;
        const query = alias ? range : `${name}@${range}`;
        const resolution =
          typeof entry.locator === 'string'
            ? /@(?:virtual:[^#]+#)?npm:([^:]+)(?:::.*)?$/.exec(entry.locator)
            : null;
        if (entry.locator !== null && !resolution)
          throw new Error('Unsupported Yarn npm resolution.');
        const current = resolution?.[1] ?? null;
        const wanted = await info(query);
        const latest = await info(`${registryName}@latest`);
        if (wanted.name !== registryName || latest.name !== registryName)
          throw new Error('Unexpected Yarn package name.');
        if (current === wanted.version && current === latest.version) continue;
        dependencies.push({
          name,
          current,
          wanted: wanted.version,
          latest: latest.version,
          dependent: workspace[1],
          location: resolve(repositoryPath, workspace[2]),
        });
      }
    }
    if (workspaces === 0)
      throw new Error('Missing Yarn workspace information.');
    return {
      packageManager: 'yarn',
      dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)),
      error: null,
    };
  } catch (error) {
    if (error instanceof DiagnosticError)
      return { code: error.code, error: error.message };
    return {
      code: 'INVALID_OUTPUT',
      error: 'Yarn did not return a valid dependency report.',
    };
  }
}
