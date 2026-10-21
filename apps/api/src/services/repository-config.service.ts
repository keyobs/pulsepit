import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DeploymentEnvironmentConfig } from '@pulsepit/contracts';

export type RepositoryUrls = Record<string, Record<string, string>>;
export type RepositoryEnvironments = Record<
  string,
  DeploymentEnvironmentConfig[]
>;

export interface RepositoryDeploymentConfig {
  urls: RepositoryUrls;
  hosting: RepositoryUrls;
  environments: RepositoryEnvironments;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadRepositoryDeploymentConfig(
  configPath = join(homedir(), '.config', 'pulsepit', 'config.json'),
): Promise<RepositoryDeploymentConfig> {
  let content: string;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { urls: {}, hosting: {}, environments: {} };
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
  if (data.repositories === undefined)
    return { urls: {}, hosting: {}, environments: {} };
  if (!isObject(data.repositories))
    throw new Error('The repositories configuration must be an object.');

  const result: RepositoryDeploymentConfig = {
    urls: {},
    hosting: {},
    environments: {},
  };
  for (const [path, settings] of Object.entries(data.repositories)) {
    if (!isAbsolute(path))
      throw new Error('Configured repository paths must be absolute.');
    const normalizedPath = resolve(path);
    if (Object.hasOwn(result.urls, normalizedPath))
      throw new Error(
        `Duplicate repository configuration for ${normalizedPath}.`,
      );
    if (!isObject(settings))
      throw new Error(`Repository settings must be an object for ${path}.`);
    const urls = validateLinks(settings.urls, 'urls', path);
    const hosting = validateLinks(settings.hosting, 'hosting', path);
    if (
      settings.deployments !== undefined &&
      (Object.keys(urls).length > 0 || Object.keys(hosting).length > 0)
    ) {
      throw new Error(
        `Repository ${path} must not mix deployments with non-empty urls or hosting.`,
      );
    }
    const environments =
      settings.deployments === undefined
        ? legacyEnvironments(urls, hosting)
        : validateDeployments(settings.deployments, path);
    result.environments[normalizedPath] = environments;
    result.urls[normalizedPath] = Object.fromEntries(
      environments.flatMap((environment) =>
        environment.url === null
          ? []
          : [[environment.environment, environment.url]],
      ),
    );
    result.hosting[normalizedPath] = Object.fromEntries(
      environments.flatMap((environment) =>
        environment.hosting?.url == null
          ? []
          : [[environment.environment, environment.hosting.url]],
      ),
    );
  }
  return result;
}

function validateDeployments(
  value: unknown,
  path: string,
): DeploymentEnvironmentConfig[] {
  if (!isObject(value))
    throw new Error(`Repository deployments must be an object for ${path}.`);
  return Object.entries(value).map(([environment, settings]) => {
    if (!isObject(settings))
      throw new Error(`Invalid deployment ${environment} for ${path}.`);
    const parsed = DeploymentEnvironmentConfig.safeParse({
      ...settings,
      environment,
    });
    if (
      !parsed.success ||
      !environment.trim() ||
      !parsed.data.label.trim() ||
      (parsed.data.branch !== null && !parsed.data.branch.trim()) ||
      (parsed.data.hosting !== null && !parsed.data.hosting.label.trim())
    ) {
      throw new Error(
        `Invalid deployment settings for ${environment} in ${path}.`,
      );
    }
    for (const url of [parsed.data.url, parsed.data.hosting?.url]) {
      if (url != null) validateUrl(url, environment, path);
    }
    return {
      ...parsed.data,
      url: parsed.data.url === null ? null : new URL(parsed.data.url).href,
      hosting:
        parsed.data.hosting === null
          ? null
          : {
              ...parsed.data.hosting,
              url:
                parsed.data.hosting.url === null
                  ? null
                  : new URL(parsed.data.hosting.url).href,
            },
    };
  });
}

// Compatibility only: canonical deployments always supply the hosting label.
function legacyHostingLabel(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  const known: [string, string][] = [
    ['vercel.com', 'Vercel'],
    ['netlify.com', 'Netlify'],
    ['scaleway.com', 'Scaleway'],
    ['ovh.com', 'OVH'],
    ['ovhcloud.com', 'OVHcloud'],
    ['aws.amazon.com', 'AWS'],
    ['cloud.google.com', 'Google Cloud'],
    ['azure.com', 'Azure'],
    ['github.com', 'GitHub'],
    ['gitlab.com', 'GitLab'],
    ['render.com', 'Render'],
    ['fly.io', 'Fly.io'],
    ['railway.app', 'Railway'],
    ['cloudflare.com', 'Cloudflare'],
    ['heroku.com', 'Heroku'],
  ];
  const match = known.find(
    ([suffix]) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (match) return match[1];
  const parts = hostname
    .replace(/^(www|console|app|dashboard)\./, '')
    .split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function legacyEnvironments(
  urls: Record<string, string>,
  hosting: Record<string, string>,
): DeploymentEnvironmentConfig[] {
  return [...new Set([...Object.keys(urls), ...Object.keys(hosting)])].map(
    (environment) => ({
      environment,
      label:
        environment === 'production'
          ? 'Production'
          : environment === 'staging'
            ? 'Test'
            : environment,
      branch: null,
      url: Object.hasOwn(urls, environment) ? urls[environment] : null,
      hosting: Object.hasOwn(hosting, environment)
        ? {
            label: legacyHostingLabel(hosting[environment]),
            url: hosting[environment],
          }
        : null,
    }),
  );
}

export function getDeploymentEnvironments(
  path: string,
  environments: RepositoryEnvironments,
  urls: RepositoryUrls,
  hosting: RepositoryUrls,
): DeploymentEnvironmentConfig[] {
  return (
    environments[path] ??
    legacyEnvironments(urls[path] ?? {}, hosting[path] ?? {})
  );
}

function validateUrl(value: string, field: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${field} URL in ${path}.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `URLs must use HTTP or HTTPS without embedded credentials for ${field} in ${path}.`,
    );
  }
  return url;
}

function validateLinks(
  value: unknown,
  field: 'urls' | 'hosting',
  path: string,
): Record<string, string> {
  const links = value === undefined ? {} : value;
  if (!isObject(links))
    throw new Error(`Repository ${field} must be an object for ${path}.`);
  const validated: Record<string, string> = {};
  for (const [environment, value] of Object.entries(links)) {
    if (!environment.trim() || typeof value !== 'string' || !value.trim()) {
      throw new Error(
        `Repository ${field} must map non-empty environment names to URL strings for ${path}.`,
      );
    }
    const url = validateUrl(value, `${field}.${environment}`, path);
    Object.defineProperty(validated, environment, {
      value: url.href,
      enumerable: true,
    });
  }
  return validated;
}

export async function loadRepositoryUrls(
  configPath?: string,
): Promise<RepositoryUrls> {
  return (await loadRepositoryDeploymentConfig(configPath)).urls;
}
