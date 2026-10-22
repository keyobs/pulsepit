import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createCommandEnvironment } from '../processes/command-environment.service.js';
import type { OutdatedDependency, OutdatedResult } from './outdated.service.js';

const execute = promisify(execFile);
type FailureCode =
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

export async function getYarnOutdatedDependencies(
  repositoryPath: string,
): Promise<OutdatedResult> {
  const deadline = Date.now() + 30_000;
  async function run(args: string[]): Promise<string> {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new DiagnosticError(
        'TIMEOUT',
        'Dependency check timed out after 30 seconds.',
      );
    try {
      const { stdout } = await execute('yarn', args, {
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
      return stdout;
    } catch (error) {
      const failure = error as { code?: string; signal?: string };
      if (failure.signal === 'SIGKILL')
        throw new DiagnosticError(
          'TIMEOUT',
          'Dependency check timed out after 30 seconds.',
        );
      throw new DiagnosticError(
        'COMMAND_FAILED',
        failure.code === 'ENOENT'
          ? 'yarn executable was not found in PATH.'
          : 'Unable to run Yarn dependency check. Ensure Yarn Modern and a valid lockfile are available.',
      );
    }
  }

  try {
    const version = (await run(['--version'])).trim();
    const match = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(version);
    if (!match) throw new Error('Invalid Yarn version.');
    if (Number(match[1]) < 2) {
      throw new DiagnosticError(
        'PACKAGE_MANAGER',
        'Yarn Classic is not supported. Use Yarn Modern (2 or later).',
      );
    }

    const nodes = records(await run(['info', '--all', '--json']));
    if (nodes.length === 0)
      throw new Error('Missing Yarn project information.');
    const metadata = new Map<string, { name: string; version: string }>();
    async function info(query: string) {
      const cached = metadata.get(query);
      if (cached) return cached;
      const result = records(
        await run(['npm', 'info', query, '--fields', 'name,version', '--json']),
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
