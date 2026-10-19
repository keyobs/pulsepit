import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface PackageManagerDetection {
  name: PackageManager | null;
  source: 'packageManager' | 'lockfile' | null;
  error: string | null;
}

export async function detectPackageManager(
  repositoryPath: string,
): Promise<PackageManagerDetection> {
  try {
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        await readFile(join(repositoryPath, 'package.json'), 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { name: null, source: null, error: null };
      }
      return {
        name: null,
        source: null,
        error:
          'Unable to read a valid package.json from the working directory.',
      };
    }

    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      Array.isArray(manifest)
    ) {
      return {
        name: null,
        source: null,
        error: 'package.json must contain a JSON object.',
      };
    }

    if ('packageManager' in manifest) {
      const match =
        typeof manifest.packageManager === 'string'
          ? /^(npm|pnpm|yarn)@\S+$/.exec(manifest.packageManager)
          : null;
      if (!match) {
        return {
          name: null,
          source: null,
          error: 'Unsupported or invalid packageManager field.',
        };
      }
      return {
        name: match[1] as PackageManager,
        source: 'packageManager',
        error: null,
      };
    }

    const entries = await readdir(repositoryPath, { withFileTypes: true });
    const files = new Set(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
    const candidates: PackageManager[] = [];
    if (files.has('package-lock.json') || files.has('npm-shrinkwrap.json'))
      candidates.push('npm');
    if (files.has('pnpm-lock.yaml')) candidates.push('pnpm');
    if (files.has('yarn.lock')) candidates.push('yarn');

    if (candidates.length > 1) {
      return {
        name: null,
        source: null,
        error:
          'Multiple package managers detected. Set packageManager in package.json.',
      };
    }
    return {
      name: candidates[0] ?? null,
      source: candidates.length === 1 ? 'lockfile' : null,
      error: null,
    };
  } catch {
    return {
      name: null,
      source: null,
      error: 'Unable to detect the package manager from the working directory.',
    };
  }
}
