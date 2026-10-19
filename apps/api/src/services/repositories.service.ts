import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  GitStatus,
  Repository as RepositoryContract,
  ScanError,
} from '@pulsepit/contracts';
import { getGitStatus } from './git.service.js';
import { getDevelopLastCommitAt } from './git-commit.service.js';
import { getOriginRemote } from './git-origin.service.js';
import { getGitSync } from './git-sync.service.js';
import { getPackageEngines, getPackageVersions } from './package.service.js';
import { detectPackageManager } from './package-manager.service.js';

// Deployment links are added by the route after scanning local repositories.
export type Repository = Omit<RepositoryContract, 'urls' | 'hosting'>;

export type { ScanError } from '@pulsepit/contracts';

export interface ScanResult {
  scanPaths: string[];
  repositories: Repository[];
  scanErrors: ScanError[];
}

export async function findConfiguredRepository(
  repositoryPath: string,
  scanPaths: string[],
): Promise<Pick<Repository, 'name' | 'path'> | null> {
  const path = resolve(repositoryPath);
  if (
    !scanPaths.some((scanPath) => {
      const parent = resolve(scanPath);
      return path !== parent && dirname(path) === parent;
    })
  ) {
    return null;
  }

  try {
    // Match the scan: direct directories only, without following symlinks.
    const directory = await lstat(path);
    if (!directory.isDirectory()) return null;
    const gitEntry = await lstat(join(path, '.git'));
    if (!gitEntry.isDirectory() && !gitEntry.isFile()) return null;
    return { name: basename(path), path };
  } catch {
    return null;
  }
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

  for (const path of uniquePaths) {
    try {
      repositories.push(...(await scanDirectory(path, scanErrors)));
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
): Promise<Repository[]> {
  const entries = await readdir(scanPath, { withFileTypes: true });
  const repositories: Repository[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const repositoryPath = join(scanPath, entry.name);

    try {
      // Git worktrees use a .git file instead of a directory.
      const gitEntry = await lstat(join(repositoryPath, '.git'));
      if (gitEntry.isDirectory() || gitEntry.isFile()) {
        let git: GitStatus | null = null;
        let gitError: string | null = null;
        try {
          git = await getGitStatus(repositoryPath);
        } catch {
          gitError = 'Unable to read Git status for this repository.';
        }
        repositories.push({
          name: entry.name,
          path: repositoryPath,
          git,
          gitError,
          sync:
            git === null ? null : await getGitSync(repositoryPath, git.branch),
          developLastCommitAt: await getDevelopLastCommitAt(repositoryPath),
          versions: await getPackageVersions(repositoryPath),
          ...(await getPackageEngines(repositoryPath)),
          packageManager: await detectPackageManager(repositoryPath),
          ...(await getOriginRemote(repositoryPath)),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        scanErrors.push(describeScanError(repositoryPath, error));
      }
    }
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}
