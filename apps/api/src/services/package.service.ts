import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export interface PackageEngines {
  engines: Record<string, string> | null;
  enginesError: string | null;
}

export async function getPackageEngines(
  repositoryPath: string,
): Promise<PackageEngines> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      await readFile(join(repositoryPath, 'package.json'), 'utf8'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { engines: null, enginesError: null };
    }
    return {
      engines: null,
      enginesError:
        'Unable to read a valid package.json from the working directory.',
    };
  }

  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    return {
      engines: null,
      enginesError: 'package.json must contain a JSON object.',
    };
  }
  if (!('engines' in manifest)) return { engines: null, enginesError: null };

  const engines = manifest.engines;
  if (
    typeof engines !== 'object' ||
    engines === null ||
    Array.isArray(engines) ||
    !Object.values(engines).every((value) => typeof value === 'string')
  ) {
    return {
      engines: null,
      enginesError:
        'The engines field must be an object containing string values.',
    };
  }
  return { engines: engines as Record<string, string>, enginesError: null };
}

export type PackageRef = 'head' | 'main' | 'develop';

const refs: Record<PackageRef, string> = {
  head: 'HEAD',
  main: 'refs/heads/main',
  develop: 'refs/heads/develop',
};

export type PackageManifestResult =
  | { manifest: Record<string, unknown>; error: null }
  | { manifest: null; error: string };

export interface PackageVersion {
  version: string | null;
  error: string | null;
}

export type PackageVersions = Record<PackageRef, PackageVersion>;

export async function getPackageManifest(
  repositoryPath: string,
  ref: PackageRef,
): Promise<PackageManifestResult> {
  const git = simpleGit({
    baseDir: repositoryPath,
    timeout: { block: 10_000 },
  });

  let content: string;
  try {
    content = await git.show([`${refs[ref]}:package.json`]);
  } catch {
    return {
      manifest: null,
      error: `Unable to read package.json at ${ref}. Check that the local ref and file exist.`,
    };
  }

  try {
    const manifest: unknown = JSON.parse(content);
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      Array.isArray(manifest)
    ) {
      return {
        manifest: null,
        error: `package.json must contain a JSON object at ${ref}.`,
      };
    }
    return { manifest: manifest as Record<string, unknown>, error: null };
  } catch {
    return { manifest: null, error: `Invalid package.json JSON at ${ref}.` };
  }
}

export async function getPackageVersions(
  repositoryPath: string,
): Promise<PackageVersions> {
  async function readVersion(ref: PackageRef): Promise<PackageVersion> {
    const result = await getPackageManifest(repositoryPath, ref);
    if (result.manifest === null) return { version: null, error: result.error };

    const version = result.manifest.version;
    if (typeof version === 'string' && version.trim().length > 0) {
      return { version, error: null };
    }
    return { version: null, error: `No valid version field at ${ref}.` };
  }

  return {
    head: await readVersion('head'),
    main: await readVersion('main'),
    develop: await readVersion('develop'),
  };
}
