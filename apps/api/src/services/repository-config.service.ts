import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export type RepositoryUrls = Record<string, Record<string, string>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadRepositoryUrls(
  configPath = join(homedir(), '.config', 'pulsepit', 'config.json'),
): Promise<RepositoryUrls> {
  let content: string;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(
      `Unable to read repository configuration at ${configPath}.`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(
      `Invalid JSON in repository configuration at ${configPath}.`,
    );
  }
  if (!isObject(data))
    throw new Error('Repository configuration must contain a JSON object.');
  if (data.repositories === undefined) return {};
  if (!isObject(data.repositories))
    throw new Error('The repositories configuration must be an object.');

  const result: RepositoryUrls = {};
  for (const [path, settings] of Object.entries(data.repositories)) {
    if (!isAbsolute(path))
      throw new Error('Configured repository paths must be absolute.');
    const normalizedPath = resolve(path);
    if (Object.hasOwn(result, normalizedPath))
      throw new Error(
        `Duplicate repository configuration for ${normalizedPath}.`,
      );
    if (!isObject(settings))
      throw new Error(`Repository settings must be an object for ${path}.`);
    const urls = settings.urls ?? {};
    if (!isObject(urls) || settings.urls === null)
      throw new Error(`Repository URLs must be an object for ${path}.`);
    const validated: Record<string, string> = {};
    for (const [environment, value] of Object.entries(urls)) {
      if (!environment.trim() || typeof value !== 'string' || !value.trim()) {
        throw new Error(
          `Repository URLs must map non-empty environment names to URL strings for ${path}.`,
        );
      }
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`Invalid URL for ${environment} in ${path}.`);
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error(
          `URLs must use HTTP or HTTPS without embedded credentials for ${environment} in ${path}.`,
        );
      }
      // Defining own properties also supports arbitrary environment names safely.
      Object.defineProperty(validated, environment, {
        value: url.href,
        enumerable: true,
      });
    }
    result[normalizedPath] = validated;
  }
  return result;
}
