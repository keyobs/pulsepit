import { simpleGit } from 'simple-git';

export interface PackageVersion {
  version: string | null;
  error: string | null;
}

export interface PackageVersions {
  head: PackageVersion;
  main: PackageVersion;
  develop: PackageVersion;
}

export async function getPackageVersions(
  repositoryPath: string,
): Promise<PackageVersions> {
  const git = simpleGit({
    baseDir: repositoryPath,
    timeout: { block: 10_000 },
  });

  async function readVersion(ref: string): Promise<PackageVersion> {
    let content: string;
    try {
      content = await git.show([`${ref}:package.json`]);
    } catch {
      return {
        version: null,
        error: `Unable to read package.json at ${ref}. Check that the local ref and file exist.`,
      };
    }

    try {
      const manifest: unknown = JSON.parse(content);
      if (
        typeof manifest === 'object' &&
        manifest !== null &&
        'version' in manifest &&
        typeof manifest.version === 'string' &&
        manifest.version.trim().length > 0
      ) {
        return { version: manifest.version, error: null };
      }
      return { version: null, error: `No valid version field at ${ref}.` };
    } catch {
      return { version: null, error: `Invalid package.json JSON at ${ref}.` };
    }
  }

  return {
    head: await readVersion('HEAD'),
    main: await readVersion('refs/heads/main'),
    develop: await readVersion('refs/heads/develop'),
  };
}
