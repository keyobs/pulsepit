import { lstat, readdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  GitStatus,
  Repository as RepositoryContract,
  ScanError,
} from '@pulsepit/contracts';
import { getGitStatus } from '../git/git.service.js';
import {
  getDevelopLastCommitAt,
  getLastActivityAt,
} from '../git/git-commit.service.js';
import { getOriginRemote } from '../git/git-origin.service.js';
import { getGitSync } from '../git/git-sync.service.js';
import {
  getPackageEngines,
  getPackageVersions,
} from '../packages/package.service.js';
import { detectPackageManager } from '../packages/package-manager.service.js';

// Deployment links are added by the route after scanning local repositories.
export type Repository = Omit<
  RepositoryContract,
  'urls' | 'hosting' | 'deploymentEnvironments' | 'beacon' | 'gitPolicy'
>;

export type { ScanError } from '@pulsepit/contracts';

export interface ScanResult {
  scanPaths: string[];
  repositories: Repository[];
  scanErrors: ScanError[];
}

const excludedDirectories = new Set(['.git', 'node_modules']);

async function hasGitMarker(path: string): Promise<boolean> {
  try {
    const marker = await lstat(join(path, '.git'));
    return marker.isDirectory() || marker.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function findConfiguredRepository(
  repositoryPath: string,
  scanPaths: string[],
): Promise<Pick<Repository, 'name' | 'path'> | null> {
  const path = resolve(repositoryPath);
  for (const scanPath of scanPaths) {
    const root = resolve(scanPath);
    const child = relative(root, path);
    if (
      !child ||
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith(`..${sep}`)
    )
      continue;
    const parts = child.split(sep);
    if (parts.some((part) => excludedDirectories.has(part))) continue;
    try {
      let current = root;
      for (let index = 0; index < parts.length; index++) {
        current = join(current, parts[index]);
        // Check every component: lstat of the leaf alone follows ancestor links.
        if (!(await lstat(current)).isDirectory()) {
          break;
        }
        const isRepository = await hasGitMarker(current);
        if (index === parts.length - 1) {
          if (isRepository) return { name: basename(path), path };
        } else if (isRepository) {
          break;
        }
      }
    } catch {
      // Another configured root may independently make this path admissible.
    }
  }
  return null;
}

export async function getRepositoryDetails(
  repositoryPath: string,
  scanPaths: string[],
): Promise<Repository | null> {
  const repository = await findConfiguredRepository(repositoryPath, scanPaths);
  return repository === null ? null : inspectRepository(repository);
}

async function inspectRepository(
  repository: Pick<Repository, 'name' | 'path'>,
): Promise<Repository> {
  const { path } = repository;
  let git: GitStatus | null = null;
  let gitError: string | null = null;
  try {
    git = await getGitStatus(path);
  } catch {
    gitError = 'Unable to read Git status for this repository.';
  }
  return {
    ...repository,
    git,
    gitError,
    sync: git === null ? null : await getGitSync(path, git.branch),
    developLastCommitAt: await getDevelopLastCommitAt(path),
    lastActivityAt: await getLastActivityAt(path),
    versions: await getPackageVersions(path),
    ...(await getPackageEngines(path)),
    packageManager: await detectPackageManager(path),
    ...(await getOriginRemote(path)),
  };
}

function describeScanError(path: string, error: unknown): ScanError {
  const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
  const messages: Record<string, string> = {
    ENOENT: 'Directory does not exist.',
    ENOTDIR: 'Scan path is not a directory.',
    EACCES: 'Permission denied while scanning directory.',
    EPERM: 'Operation not permitted while scanning directory.',
  };
  return { path, code, message: messages[code] ?? 'Unable to scan directory.' };
}

export async function findRepositories(
  scanPath: string | string[],
): Promise<ScanResult> {
  const paths = Array.isArray(scanPath) ? scanPath : [scanPath];
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
  const repositories: Repository[] = [];
  const scanErrors: ScanError[] = [];
  const visitedDirectories = new Set<string>();
  const seenRepositories = new Set<string>();

  for (const path of uniquePaths) {
    try {
      repositories.push(
        ...(await scanDirectory(
          path,
          scanErrors,
          visitedDirectories,
          seenRepositories,
        )),
      );
    } catch (error) {
      scanErrors.push(describeScanError(path, error));
    }
  }

  return {
    scanPaths: uniquePaths,
    repositories: repositories.sort((a, b) => a.name.localeCompare(b.name)),
    scanErrors,
  };
}

async function scanDirectory(
  scanPath: string,
  scanErrors: ScanError[],
  visitedDirectories: Set<string>,
  seenRepositories: Set<string>,
): Promise<Repository[]> {
  const repositories: Repository[] = [];
  const pending = [scanPath];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    if (visitedDirectories.has(directory)) continue;
    visitedDirectories.add(directory);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || excludedDirectories.has(entry.name))
          continue;
        const path = join(directory, entry.name);
        try {
          if (!(await lstat(path)).isDirectory()) continue;
          if (await hasGitMarker(path)) {
            if (!seenRepositories.has(path)) {
              seenRepositories.add(path);
              repositories.push(
                await inspectRepository({ name: entry.name, path }),
              );
            }
          } else {
            pending.push(path);
          }
        } catch (error) {
          scanErrors.push(describeScanError(path, error));
        }
      }
    } catch (error) {
      scanErrors.push(describeScanError(directory, error));
    }
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}
