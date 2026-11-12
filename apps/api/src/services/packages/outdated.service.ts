import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify, stripVTControlCharacters } from 'node:util';
import type {
  OutdatedDependency,
  OutdatedResponse,
  RegistryDiagnosticCode,
} from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';
import {
  buildPackageInventory,
  isPrivatePackage,
  readDeclaredDependencies,
  readPrivateScopes,
} from './package-inventory.service.js';
import { detectPackageManager } from './package-manager.service.js';
import { registryDiagnostic } from './registry-diagnostic.service.js';
import {
  findNestedProjects,
  findWorkspaces,
  type WorkspaceDirectory,
} from './workspaces.service.js';
import { getYarnOutdatedDependencies } from './yarn-outdated.service.js';

const execute = promisify(execFile);

export type { OutdatedDependency } from '@pulsepit/contracts';

type OutdatedFailure = {
  code:
    | 'PACKAGE_MANAGER'
    | 'TIMEOUT'
    | 'COMMAND_FAILED'
    | 'INVALID_OUTPUT'
    | RegistryDiagnosticCode;
  error: string;
  resetAt?: string;
};
export type OutdatedReport =
  | Omit<OutdatedResponse, 'path' | 'packages' | 'workspaces'>
  | OutdatedFailure;
export type OutdatedResult = Omit<OutdatedResponse, 'path'> | OutdatedFailure;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// pnpm can surround JSON with registry or native-launcher warnings on stdout.
function pnpmJson(output: string): string {
  const lines = output.split(/\r?\n/);
  const launcherWarning = [
    'pnpm is running through Node.js because the script that installs its native binary was skipped.',
    'Reinstall pnpm with its build scripts allowed to run the binary directly.',
  ];
  // Only discard the complete, known launcher message at the start of stdout.
  // Arbitrary text and fatal errors must still invalidate the report.
  if (
    launcherWarning.every(
      (line, index) =>
        stripVTControlCharacters(lines[index] ?? '').trim() === line,
    )
  )
    lines.splice(0, launcherWarning.length);
  const ancillary = (line: string) =>
    !line.trim() ||
    /^\s*(?:WARN|\[WARN\])(?:\s|$)/u.test(stripVTControlCharacters(line));
  let start = 0;
  let end = lines.length;
  while (start < end && ancillary(lines[start])) start++;
  while (end > start && ancillary(lines[end - 1])) end--;
  return lines.slice(start, end).join('\n');
}

function parseDependencies(
  output: string,
  manager: 'npm' | 'pnpm',
): OutdatedDependency[] {
  const data: unknown = JSON.parse(
    manager === 'pnpm' ? pnpmJson(output) : output,
  );
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
  const workspaces = await findWorkspaces(repositoryPath);
  const projects = workspaces.length
    ? []
    : await findNestedProjects(repositoryPath);
  const [root, ...nested] = await Promise.all([
    diagnoseProject(repositoryPath, workspaces),
    ...projects.map((project) =>
      project.technology ? null : diagnoseProject(project.absolutePath, []),
    ),
  ]);
  if (root.error !== null) return root;
  return {
    ...root,
    workspaces: [
      ...root.workspaces,
      ...projects.map((project, index) => {
        const result = nested[index];
        if (!result)
          return {
            name: project.name,
            path: project.path,
            standalone: true,
            technology: project.technology ?? null,
            packageManager: null,
            packages: [],
            error: null,
          };
        return {
          name: project.name,
          path: project.path,
          standalone: true,
          technology: null,
          packageManager: result.error === null ? result.packageManager : null,
          packages: result.error === null ? result.packages : [],
          error: result.error,
        };
      }),
    ],
  };
}

async function diagnoseProject(
  repositoryPath: string,
  workspaceDirectories: WorkspaceDirectory[],
): Promise<OutdatedResult> {
  const manager = await detectPackageManager(repositoryPath);
  if (manager.error || manager.name === null) {
    return {
      code: 'PACKAGE_MANAGER',
      error:
        manager.error ?? 'No package manager detected for this repository.',
    };
  }
  const declared = await readDeclaredDependencies(repositoryPath).catch(
    () => [],
  );
  const workspaces = await Promise.all(
    workspaceDirectories.map(async (workspace) => ({
      ...workspace,
      declared: await readDeclaredDependencies(workspace.absolutePath).catch(
        () => [],
      ),
    })),
  );
  const allDeclared = [
    ...declared,
    ...workspaces.flatMap((workspace) => workspace.declared),
  ];
  const scopes = await readPrivateScopes(repositoryPath);
  const isPrivate = (name: string) => isPrivatePackage(name, scopes);
  // With private packages, only public ones are queried: their registry may be unreachable.
  const hasPrivate = allDeclared.some(({ name }) => isPrivate(name));
  const publicNames = hasPrivate
    ? [
        ...new Set(
          allDeclared
            .filter(
              ({ name, declared: range }) =>
                !isPrivate(name) && !range.startsWith('workspace:'),
            )
            .map(({ name }) => name),
        ),
      ]
    : [];
  const report: OutdatedReport =
    hasPrivate && !publicNames.length
      ? { packageManager: manager.name, dependencies: [], error: null }
      : manager.name === 'yarn'
        ? await getYarnOutdatedDependencies(
            repositoryPath,
            publicNames,
            isPrivate,
          )
        : await collectOutdated(repositoryPath, manager.name, publicNames);
  if (report.error !== null) return report;
  const owners = report.dependencies.map((entry) =>
    workspaces.find(
      (workspace) =>
        entry.location === workspace.absolutePath ||
        (entry.dependent !== null &&
          (entry.dependent === workspace.name ||
            entry.dependent === basename(workspace.absolutePath))),
    ),
  );
  return {
    ...report,
    packages: await buildPackageInventory(
      repositoryPath,
      declared,
      report.dependencies.filter((_, index) => !owners[index]),
      scopes,
    ),
    workspaces: await Promise.all(
      workspaces.map(async (workspace) => ({
        name: workspace.name,
        path: workspace.path,
        standalone: false,
        technology: null,
        packageManager: manager.name,
        error: null,
        packages: await buildPackageInventory(
          workspace.absolutePath,
          workspace.declared,
          report.dependencies.filter((_, index) => owners[index] === workspace),
          scopes,
          repositoryPath,
        ),
      })),
    ),
  };
}

async function collectOutdated(
  repositoryPath: string,
  name: 'npm' | 'pnpm',
  packageNames: string[],
): Promise<OutdatedReport> {
  const args =
    name === 'npm'
      ? ['outdated', '--json', '--ignore-scripts', ...packageNames]
      : [
          '--recursive',
          '--include-workspace-root',
          'outdated',
          '--format',
          'json',
          ...packageNames,
        ];

  let output: string;
  let outdatedExit = false;
  try {
    const result = await execute(name, args, {
      cwd: repositoryPath,
      timeout: 90_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: createCommandEnvironment('package-manager'),
    });
    const registry = registryDiagnostic(
      name,
      name === 'pnpm' ? pnpmJson(result.stdout) : result.stdout,
      result.stderr,
      false,
    );
    if (registry) return registry;
    output = result.stdout;
  } catch (error) {
    const failure = error as {
      code?: string | number;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    if (failure.signal === 'SIGKILL') {
      return {
        code: 'TIMEOUT',
        error: 'Dependency check timed out after 90 seconds.',
      };
    }
    const registry = registryDiagnostic(
      name,
      name === 'pnpm' ? pnpmJson(failure.stdout ?? '') : (failure.stdout ?? ''),
      failure.stderr ?? '',
      true,
    );
    if (registry) return registry;
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
