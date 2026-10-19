import { simpleGit } from 'simple-git';

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
