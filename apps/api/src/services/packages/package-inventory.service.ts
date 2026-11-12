import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  OutdatedDependency,
  PackageDependency,
} from '@pulsepit/contracts';

const sections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
] as const;
const publicRegistries = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com',
]);

export type DeclaredDependency = Pick<
  PackageDependency,
  'name' | 'section' | 'declared'
>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readDeclaredDependencies(
  repositoryPath: string,
): Promise<DeclaredDependency[]> {
  const manifest: unknown = JSON.parse(
    await readFile(join(repositoryPath, 'package.json'), 'utf8'),
  );
  if (!isObject(manifest)) return [];
  const seen = new Set<string>();
  const declared: DeclaredDependency[] = [];
  for (const section of sections) {
    const entries = manifest[section];
    if (!isObject(entries)) continue;
    for (const [name, range] of Object.entries(entries)) {
      if (typeof range !== 'string' || seen.has(name)) continue;
      seen.add(name);
      declared.push({ name, section, declared: range });
    }
  }
  return declared;
}

// Scopes mapped to a non-public registry in the project or user .npmrc.
export async function readPrivateScopes(
  repositoryPath: string,
  home = homedir(),
): Promise<Set<string>> {
  const scopes = new Set<string>();
  for (const file of [join(repositoryPath, '.npmrc'), join(home, '.npmrc')]) {
    const content = await readFile(file, 'utf8').catch(() => '');
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*(@[^:\s]+):registry\s*=\s*(\S+)/.exec(line);
      if (!match) continue;
      let host: string;
      try {
        host = new URL(match[2]).hostname;
      } catch {
        host = '';
      }
      if (!publicRegistries.has(host)) scopes.add(match[1]);
    }
  }
  return scopes;
}

export const isPrivatePackage = (name: string, scopes: Set<string>) =>
  name.startsWith('@') && scopes.has(name.slice(0, name.indexOf('/')));

async function installedVersion(roots: string[], name: string) {
  for (const root of roots) {
    try {
      const manifest: unknown = JSON.parse(
        await readFile(
          join(root, 'node_modules', name, 'package.json'),
          'utf8',
        ),
      );
      if (isObject(manifest) && typeof manifest.version === 'string')
        return manifest.version;
    } catch {}
  }
  return null;
}

export async function buildPackageInventory(
  repositoryPath: string,
  declared: DeclaredDependency[],
  outdated: OutdatedDependency[],
  scopes: Set<string>,
  hoistedRoot?: string,
): Promise<PackageDependency[]> {
  // Workspace dependencies may be hoisted to the repository root.
  const roots = hoistedRoot ? [repositoryPath, hoistedRoot] : [repositoryPath];
  const packages = await Promise.all(
    declared.map(async (dependency): Promise<PackageDependency> => {
      const installed = await installedVersion(roots, dependency.name);
      if (isPrivatePackage(dependency.name, scopes))
        return {
          ...dependency,
          installed,
          wanted: null,
          latest: null,
          status: 'private',
        };
      const report = outdated.find((entry) => entry.name === dependency.name);
      if (report)
        return {
          ...dependency,
          installed: report.current ?? installed,
          wanted: report.wanted,
          latest: report.latest,
          status: 'outdated',
        };
      return {
        ...dependency,
        installed,
        wanted: installed,
        latest: installed,
        status: 'current',
      };
    }),
  );
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}
