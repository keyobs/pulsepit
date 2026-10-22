import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DeploymentEnvironmentConfig } from '@pulsepit/contracts';

export type RepositoryUrls = Record<string, Record<string, string>>;
export interface StaticMetadataSource {
  type: 'static';
  url: string;
}
export interface GithubPagesDateSource {
  type: 'github-pages';
  environment: string;
}
export interface VercelDateSource {
  type: 'vercel';
  projectId: string;
  teamId?: string;
}
export type DeploymentDateSource = GithubPagesDateSource | VercelDateSource;
export type ConfiguredDeploymentEnvironment = DeploymentEnvironmentConfig & {
  metadata?: StaticMetadataSource;
  deploymentDate?: DeploymentDateSource;
};
export type RepositoryEnvironments = Record<
  string,
  ConfiguredDeploymentEnvironment[]
>;

export interface RepositoryDeploymentConfig {
  urls: RepositoryUrls;
  hosting: RepositoryUrls;
  environments: RepositoryEnvironments;
  errors?: RepositoryConfigurationErrors;
}

export interface RepositoryConfigurationError {
  code: 'INVALID_REPOSITORY_CONFIGURATION';
  message: string;
}
export type RepositoryConfigurationErrors = Record<
  string,
  RepositoryConfigurationError
>;

class InvalidRepositorySettings extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadRepositoryDeploymentConfig(
  configPath = join(homedir(), '.config', 'pulsepit', 'config.json'),
  options: { isolateInvalidRepositories?: boolean } = {},
): Promise<RepositoryDeploymentConfig> {
  const empty = (): RepositoryDeploymentConfig => ({
    urls: {},
    hosting: {},
    environments: {},
    ...(options.isolateInvalidRepositories ? { errors: {} } : {}),
  });
  let content: string;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
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
  if (data.repositories === undefined) return empty();
  if (!isObject(data.repositories))
    throw new Error('The repositories configuration must be an object.');

  const result = empty();
  const seen = new Set<string>();
  for (const [path, settings] of Object.entries(data.repositories)) {
    const normalizedPath = isAbsolute(path) ? resolve(path) : path;
    try {
      if (!isAbsolute(path))
        throw new InvalidRepositorySettings(
          'Configured repository paths must be absolute.',
        );
      if (seen.has(normalizedPath))
        throw new InvalidRepositorySettings(
          `Duplicate repository configuration for ${normalizedPath}.`,
        );
      seen.add(normalizedPath);
      if (!isObject(settings))
        throw new InvalidRepositorySettings(
          `Repository settings must be an object for ${path}.`,
        );
      const urls = validateLinks(settings.urls, 'urls', path);
      const hosting = validateLinks(settings.hosting, 'hosting', path);
      if (
        settings.deployments !== undefined &&
        (Object.keys(urls).length > 0 || Object.keys(hosting).length > 0)
      ) {
        throw new InvalidRepositorySettings(
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
    } catch (error) {
      if (!result.errors) throw error;
      Object.defineProperty(result.errors, normalizedPath, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: {
          code: 'INVALID_REPOSITORY_CONFIGURATION',
          message:
            error instanceof InvalidRepositorySettings
              ? error.message
              : 'Unable to validate repository deployment configuration.',
        } satisfies RepositoryConfigurationError,
      });
      if (isAbsolute(path)) {
        result.urls[normalizedPath] = {};
        result.hosting[normalizedPath] = {};
        result.environments[normalizedPath] = [];
      }
    }
  }
  return result;
}

function validateDeployments(
  value: unknown,
  path: string,
): ConfiguredDeploymentEnvironment[] {
  if (!isObject(value))
    throw new InvalidRepositorySettings(
      `Repository deployments must be an object for ${path}.`,
    );
  return Object.entries(value).map(([environment, settings]) => {
    if (!isObject(settings))
      throw new InvalidRepositorySettings(
        `Invalid deployment ${environment} for ${path}.`,
      );
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
      throw new InvalidRepositorySettings(
        `Invalid deployment settings for ${environment} in ${path}.`,
      );
    }
    for (const url of [parsed.data.url, parsed.data.hosting?.url]) {
      if (url != null) validateUrl(url, environment, path);
    }
    return {
      ...parsed.data,
      ...(settings.metadata === undefined
        ? {}
        : {
            metadata: validateMetadataSource(
              settings.metadata,
              environment,
              path,
            ),
          }),
      ...(settings.deploymentDate === undefined
        ? {}
        : {
            deploymentDate: validateDeploymentDateSource(
              settings.deploymentDate,
              environment,
              path,
            ),
          }),
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

function validateMetadataSource(
  value: unknown,
  environment: string,
  path: string,
): StaticMetadataSource {
  if (
    !isObject(value) ||
    value.type !== 'static' ||
    typeof value.url !== 'string' ||
    Object.keys(value).some((key) => key !== 'type' && key !== 'url')
  ) {
    throw new InvalidRepositorySettings(
      `Invalid metadata source for ${environment} in ${path}.`,
    );
  }
  return {
    type: 'static',
    url: validateUrl(value.url, `metadata.${environment}`, path).href,
  };
}

function validateDeploymentDateSource(
  value: unknown,
  environment: string,
  path: string,
): DeploymentDateSource {
  if (isObject(value) && value.type === 'vercel') {
    if (
      typeof value.projectId !== 'string' ||
      !/^prj_[a-z\d]{1,128}$/i.test(value.projectId) ||
      (value.teamId !== undefined &&
        (typeof value.teamId !== 'string' ||
          !/^team_[a-z\d]{1,128}$/i.test(value.teamId))) ||
      Object.keys(value).some(
        (key) => !['type', 'projectId', 'teamId'].includes(key),
      )
    ) {
      throw new InvalidRepositorySettings(
        `Invalid deployment date source for ${environment} in ${path}.`,
      );
    }
    return {
      type: 'vercel',
      projectId: value.projectId,
      ...(value.teamId === undefined ? {} : { teamId: value.teamId }),
    };
  }
  if (
    !isObject(value) ||
    value.type !== 'github-pages' ||
    typeof value.environment !== 'string' ||
    !value.environment.trim() ||
    value.environment.length > 255 ||
    Object.keys(value).some((key) => key !== 'type' && key !== 'environment')
  ) {
    throw new InvalidRepositorySettings(
      `Invalid deployment date source for ${environment} in ${path}.`,
    );
  }
  return { type: 'github-pages', environment: value.environment };
}

export function getDeploymentDateSources(
  path: string,
  environments: RepositoryEnvironments,
): Record<string, DeploymentDateSource> {
  return Object.fromEntries(
    (environments[path] ?? []).flatMap((entry) =>
      entry.deploymentDate === undefined
        ? []
        : [[entry.environment, entry.deploymentDate]],
    ),
  );
}

export function getDeploymentMetadataSources(
  path: string,
  environments: RepositoryEnvironments,
): Record<string, StaticMetadataSource> {
  return Object.fromEntries(
    (environments[path] ?? []).flatMap((entry) =>
      entry.metadata === undefined ? [] : [[entry.environment, entry.metadata]],
    ),
  );
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
  const configured =
    environments[path] ??
    legacyEnvironments(urls[path] ?? {}, hosting[path] ?? {});
  // Collection settings stay server-side, including in list/detail responses.
  return configured.map(
    ({
      metadata: _metadata,
      deploymentDate: _deploymentDate,
      ...environment
    }: ConfiguredDeploymentEnvironment) => environment,
  );
}

function validateUrl(value: string, field: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidRepositorySettings(`Invalid ${field} URL in ${path}.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new InvalidRepositorySettings(
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
    throw new InvalidRepositorySettings(
      `Repository ${field} must be an object for ${path}.`,
    );
  const validated: Record<string, string> = {};
  for (const [environment, value] of Object.entries(links)) {
    if (!environment.trim() || typeof value !== 'string' || !value.trim()) {
      throw new InvalidRepositorySettings(
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
