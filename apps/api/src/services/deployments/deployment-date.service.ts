import type { AppConfig } from '../../config.js';
import type { DeploymentObservation } from '../beacon/deployment-metadata.service.js';
import { getOriginRemote } from '../git/git-origin.service.js';
import { getGithubPagesDeploymentDate } from '../host-provider/github-pages-deployment.service.js';
import { getVercelDeploymentDate } from '../host-provider/vercel-deployment.service.js';
import type { DeploymentDateSource } from '../repositories/repository-config.service.js';

export async function collectDeploymentDates(
  path: string,
  environments: DeploymentObservation[],
  sources: Record<string, DeploymentDateSource>,
  credentials: Pick<AppConfig, 'githubToken' | 'vercelToken'> = {},
): Promise<DeploymentObservation[]> {
  const eligible = environments.flatMap((entry, index) =>
    entry.metadataError === null &&
    entry.deployedAt === null &&
    entry.commit !== null &&
    entry.url !== null &&
    Object.hasOwn(sources, entry.environment)
      ? [index]
      : [],
  );
  if (eligible.length === 0) return environments;
  const needsGithub = eligible.some(
    (index) => sources[environments[index].environment].type === 'github-pages',
  );
  const { origin, originError } = needsGithub
    ? await getOriginRemote(path)
    : { origin: null, originError: null };
  const results = [...environments];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, eligible.length) }, async () => {
      while (next < eligible.length) {
        const index = eligible[next++];
        const entry = environments[index];
        const source = sources[entry.environment];
        const observation =
          source.type === 'vercel'
            ? await getVercelDeploymentDate({
                commit: entry.commit,
                url: entry.url,
                branch: entry.branch,
                projectId: source.projectId,
                teamId: source.teamId,
                token: credentials.vercelToken,
              })
            : originError !== null || !origin?.github
              ? {
                  deployedAt: null,
                  error: {
                    code:
                      originError !== null
                        ? 'GITHUB_REQUEST_FAILED'
                        : 'GITHUB_REPOSITORY_UNAVAILABLE',
                    message:
                      originError !== null
                        ? 'Unable to read the repository origin.'
                        : 'A github.com origin is required to read GitHub Pages deployment data.',
                  },
                }
              : await getGithubPagesDeploymentDate(origin.github, {
                  commit: entry.commit,
                  url: entry.url,
                  environment: source.environment,
                  branch: entry.branch,
                  token: credentials.githubToken,
                });
        results[index] = {
          ...entry,
          deployedAt: observation.deployedAt,
          deploymentSource: observation.deployedAt === null ? null : 'provider',
          metadataError: observation.error,
          metadataCheckedAt: new Date().toISOString(),
        };
      }
    }),
  );
  return results;
}
