import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function hasConfiguredBeacon(
  repositoryPath: string,
  hasMetadataSource: boolean,
): Promise<boolean> {
  if (!hasMetadataSource) return false;
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      await readFile(join(repositoryPath, 'package.json'), 'utf8'),
    );
  } catch {
    return false;
  }
  if (!object(manifest)) return false;
  const name = '@keyobs/pulsepit-beacon';
  return ['dependencies', 'devDependencies'].some((section) => {
    const dependencies = manifest[section];
    if (!object(dependencies) || !Object.hasOwn(dependencies, name))
      return false;
    const version = dependencies[name];
    return typeof version === 'string' && version.trim().length > 0;
  });
}
