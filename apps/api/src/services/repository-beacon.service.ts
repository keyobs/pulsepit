import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepositoryBeacon } from '@pulsepit/contracts';
import type { ConfiguredDeploymentEnvironment } from './repository-config.service.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function hasDeclaredBeacon(repositoryPath: string): Promise<boolean> {
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

export async function hasConfiguredBeacon(
  repositoryPath: string,
  hasMetadataSource: boolean,
): Promise<boolean> {
  return hasMetadataSource && (await hasDeclaredBeacon(repositoryPath));
}

export async function inspectRepositoryBeacon(
  repositoryPath: string,
  environments: Pick<ConfiguredDeploymentEnvironment, 'metadata'>[],
  invalidConfiguration = false,
): Promise<RepositoryBeacon> {
  const declared = await hasDeclaredBeacon(repositoryPath);
  const configured = environments.filter(
    (entry) => entry.metadata !== undefined,
  ).length;
  const configuration = invalidConfiguration
    ? 'invalid'
    : configured === 0
      ? 'missing'
      : configured < environments.length
        ? 'partial'
        : 'ok';
  return {
    package: declared,
    configuration,
    active: declared && (configuration === 'partial' || configuration === 'ok'),
  };
}
