import type {
  BranchesResponse,
  ErrorResponse,
  ListRepositoriesResponse,
  OriginResponse,
  PackageResponse,
  Repository as RepositoryResponse,
  WorkflowsResponse,
} from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { getLocalBranches } from '../../services/git.service.js';
import { getOriginRemote } from '../../services/git-origin.service.js';
import {
  assessBranchPush,
  type RepositoryGitPolicies,
  repositoryGitPolicy,
} from '../../services/git-policy.service.js';
import {
  getPackageManifest,
  type PackageRef,
} from '../../services/package.service.js';
import {
  findConfiguredRepository,
  findRepositories,
  getRepositoryDetails,
  type Repository,
} from '../../services/repositories.service.js';
import { inspectRepositoryBeacon } from '../../services/repository-beacon.service.js';
import {
  getDeploymentEnvironments,
  type RepositoryConfigurationErrors,
  type RepositoryEnvironments,
  type RepositoryUrls,
} from '../../services/repository-config.service.js';
import { getRepositoryWorkflows } from '../../services/workflows.service.js';

export const getRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & {
    repositoryUrls: RepositoryUrls;
    repositoryHosting: RepositoryUrls;
    repositoryEnvironments: RepositoryEnvironments;
    repositoryConfigurationErrors: RepositoryConfigurationErrors;
    repositoryGitPolicies: RepositoryGitPolicies;
  }
> = async (app, options) => {
  const withRepositoryConfiguration = async (
    repository: Repository,
  ): Promise<RepositoryResponse> => ({
    ...repository,
    gitPolicy: repositoryGitPolicy(
      repository.path,
      options.repositoryGitPolicies,
    ),
    beacon: await inspectRepositoryBeacon(
      repository.path,
      options.repositoryEnvironments[repository.path] ?? [],
      Object.hasOwn(options.repositoryConfigurationErrors, repository.path),
    ),
    urls: options.repositoryUrls[repository.path] ?? {},
    hosting: options.repositoryHosting[repository.path] ?? {},
    deploymentEnvironments: getDeploymentEnvironments(
      repository.path,
      options.repositoryEnvironments,
      options.repositoryUrls,
      options.repositoryHosting,
    ),
  });

  app.get('', async () => {
    const result = await findRepositories(options.scanPaths);
    const configurationErrors = result.repositories.flatMap(({ path }) => {
      if (!Object.hasOwn(options.repositoryConfigurationErrors, path))
        return [];
      const error = options.repositoryConfigurationErrors[path];
      return [{ path, code: error.code, message: error.message }];
    });
    return {
      ...result,
      repositories: await Promise.all(
        result.repositories.map(withRepositoryConfiguration),
      ),
      scanErrors: [...result.scanErrors, ...configurationErrors],
    } satisfies ListRepositoriesResponse;
  });

  app.get<{ Querystring: { path: string } }>(
    '/detail',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const repository = await getRepositoryDetails(
        request.query.path,
        options.scanPaths,
      );
      if (repository === null) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        } satisfies ErrorResponse);
      }
      return withRepositoryConfiguration(repository);
    },
  );

  app.get<{ Querystring: { path: string } }>(
    '/origin',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const repository = await findConfiguredRepository(
        request.query.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }
      return {
        path: repository.path,
        ...(await getOriginRemote(repository.path)),
      } satisfies OriginResponse;
    },
  );

  app.get<{ Querystring: { path: string } }>(
    '/workflows',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const repository = await findConfiguredRepository(
        request.query.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }
      return {
        path: repository.path,
        ...(await getRepositoryWorkflows(repository.path)),
      } satisfies WorkflowsResponse;
    },
  );

  app.get<{ Querystring: { path: string } }>(
    '/branches',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const repository = await findConfiguredRepository(
        request.query.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }
      const result = await getLocalBranches(repository.path);
      if (result.error !== null) {
        return reply.code(result.code === 'TIMEOUT' ? 504 : 502).send(result);
      }
      return {
        path: repository.path,
        branches: result.branches.map((branch) => ({
          ...branch,
          ...assessBranchPush(
            repositoryGitPolicy(repository.path, options.repositoryGitPolicies),
            branch.name,
          ),
        })),
      } satisfies BranchesResponse;
    },
  );

  app.get<{ Querystring: { path: string; ref?: PackageRef } }>(
    '/package',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1 },
            ref: { type: 'string', enum: ['head', 'main', 'develop'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { path, ref = 'head' } = request.query;
      const repository = await findConfiguredRepository(
        path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }

      const result = await getPackageManifest(repository.path, ref);
      if (result.manifest === null) {
        return reply.code(422).send({ error: result.error });
      }
      return {
        path: repository.path,
        ref,
        manifest: result.manifest,
      } satisfies PackageResponse;
    },
  );
};
