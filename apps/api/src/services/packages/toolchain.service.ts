import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepositoryToolchain, ToolVersion } from '@pulsepit/contracts';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

async function readVersionFile(repositoryPath: string, file: string) {
  const content = await readFile(join(repositoryPath, file), 'utf8').catch(
    () => '',
  );
  return text(content.split(/\r?\n/)[0]);
}

export async function getRepositoryToolchain(
  repositoryPath: string,
  manager: string | null,
): Promise<RepositoryToolchain> {
  let manifest: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(repositoryPath, 'package.json'), 'utf8'),
    );
    if (isObject(parsed)) manifest = parsed;
  } catch {
    // Without a manifest, only version files can declare Node.
  }
  const volta = isObject(manifest.volta) ? manifest.volta : {};
  const engines = isObject(manifest.engines) ? manifest.engines : {};

  let node: ToolVersion | null = null;
  for (const [version, source] of [
    [await readVersionFile(repositoryPath, '.nvmrc'), '.nvmrc'],
    [await readVersionFile(repositoryPath, '.node-version'), '.node-version'],
    [text(volta.node), 'volta'],
    [text(engines.node), 'engines'],
  ] as const) {
    if (version) {
      node = { version, source };
      break;
    }
  }

  let packageManager: ToolVersion | null = null;
  const declared = text(manifest.packageManager);
  const pinned = declared
    ? /^(?:npm|pnpm|yarn)@([^+\s]+)/.exec(declared)?.[1]
    : undefined;
  if (pinned) packageManager = { version: pinned, source: 'packageManager' };
  else if (manager) {
    const fromVolta = text(volta[manager]);
    const fromEngines = text(engines[manager]);
    if (fromVolta) packageManager = { version: fromVolta, source: 'volta' };
    else if (fromEngines)
      packageManager = { version: fromEngines, source: 'engines' };
  }
  return { node, packageManager };
}
