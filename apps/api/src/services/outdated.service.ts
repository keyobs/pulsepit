import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectPackageManager } from './package-manager.service.js';
import { getYarnOutdatedDependencies } from './yarn-outdated.service.js';

const execute = promisify(execFile);

export interface OutdatedDependency {
  name: string;
  current: string | null;
  wanted: string;
  latest: string;
  dependent: string | null;
  location: string | null;
}

export type OutdatedResult =
  | {
      packageManager: 'npm' | 'pnpm' | 'yarn';
      dependencies: OutdatedDependency[];
      error: null;
    }
  | {
      code: 'PACKAGE_MANAGER' | 'TIMEOUT' | 'COMMAND_FAILED' | 'INVALID_OUTPUT';
      error: string;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDependencies(
  output: string,
  manager: 'npm' | 'pnpm',
): OutdatedDependency[] {
  const data: unknown = JSON.parse(output);
  if (!isObject(data)) throw new Error('Invalid dependency report.');

  const dependencies: OutdatedDependency[] = [];
  for (const [name, value] of Object.entries(data)) {
    // npm can return several entries for a dependency used in workspaces.
    const entries = Array.isArray(value) ? value : [value];
    if (entries.length === 0) throw new Error('Invalid dependency report.');
    for (const entry of entries) {
      if (
        !isObject(entry) ||
        typeof entry.wanted !== 'string' ||
        typeof entry.latest !== 'string' ||
        (entry.current !== undefined && typeof entry.current !== 'string') ||
        (entry.dependent !== undefined &&
          typeof entry.dependent !== 'string') ||
        (entry.location !== undefined && typeof entry.location !== 'string')
      ) {
        throw new Error('Invalid dependency report.');
      }
      const dependency = {
        // Recent pnpm versions disambiguate workspace entries with keys such
        // as "package@1.0.0 (dev)" or "@scope/package@1.0.0".
        name:
          manager === 'pnpm' && name.indexOf('@', 1) !== -1
            ? name.slice(0, name.indexOf('@', 1))
            : name,
        current: entry.current ?? null,
        wanted: entry.wanted,
        latest: entry.latest,
        dependent: entry.dependent ?? null,
        location: entry.location ?? null,
      };
      if (manager === 'pnpm' && entry.dependentPackages !== undefined) {
        if (
          !Array.isArray(entry.dependentPackages) ||
          entry.dependentPackages.length === 0
        ) {
          throw new Error('Invalid pnpm output.');
        }
        for (const dependent of entry.dependentPackages) {
          if (
            !isObject(dependent) ||
            (dependent.name !== undefined &&
              typeof dependent.name !== 'string') ||
            typeof dependent.location !== 'string'
          ) {
            throw new Error('Invalid pnpm output.');
          }
          dependencies.push({
            ...dependency,
            dependent: dependent.name ?? null,
            location: dependent.location,
          });
        }
      } else {
        dependencies.push(dependency);
      }
    }
  }
  return dependencies.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOutdatedDependencies(
  repositoryPath: string,
): Promise<OutdatedResult> {
  const manager = await detectPackageManager(repositoryPath);
  if (manager.error || manager.name === null) {
    return {
      code: 'PACKAGE_MANAGER',
      error:
        manager.error ?? 'No package manager detected for this repository.',
    };
  }
  if (manager.name === 'yarn') {
    return getYarnOutdatedDependencies(repositoryPath);
  }

  const name = manager.name;
  const args =
    name === 'npm'
      ? ['outdated', '--json', '--ignore-scripts']
      : [
          '--recursive',
          '--include-workspace-root',
          'outdated',
          '--format',
          'json',
        ];

  let output: string;
  let outdatedExit = false;
  try {
    const result = await execute(name, args, {
      cwd: repositoryPath,
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    output = result.stdout;
  } catch (error) {
    const failure = error as {
      code?: string | number;
      signal?: string;
      stdout?: string;
    };
    if (failure.signal === 'SIGKILL') {
      return {
        code: 'TIMEOUT',
        error: 'Dependency check timed out after 30 seconds.',
      };
    }
    // Both managers exit with 1 for outdated dependencies, but also on errors.
    // Only accept this exit code if stdout contains a valid, non-empty report.
    if (failure.code !== 1 || typeof failure.stdout !== 'string') {
      return {
        code: 'COMMAND_FAILED',
        error:
          failure.code === 'ENOENT'
            ? `${name} executable was not found in PATH.`
            : `Unable to run ${name} outdated for this repository.`,
      };
    }
    output = failure.stdout;
    outdatedExit = true;
  }

  try {
    const dependencies = parseDependencies(output, name);
    if (outdatedExit && dependencies.length === 0) {
      return {
        code: 'COMMAND_FAILED',
        error: `${name} outdated exited with an error.`,
      };
    }
    return { packageManager: name, dependencies, error: null };
  } catch {
    return {
      code: 'INVALID_OUTPUT',
      error: `${name} outdated did not return a valid dependency report.`,
    };
  }
}
