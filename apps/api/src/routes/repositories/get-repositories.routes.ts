import type {
  BranchesResponse,
  ErrorResponse,
  GitTreeResponse,
  ListRepositoriesResponse,
  OriginResponse,
  PackageResponse,
  PushLocks,
  Repository as RepositoryResponse,
  WorkflowsResponse,
} from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { inspectRepositoryBeacon } from '../../services/beacon/repository-beacon.service.js';
import { getLocalBranches } from '../../services/git/git.service.js';
import type { GitChecksService } from '../../services/git/git-checks.service.js';
import { getOriginRemote } from '../../services/git/git-origin.service.js';
import {
  assessBranchPush,
  type RepositoryGitPolicies,
  repositoryGitPolicy,
} from '../../services/git/git-policy.service.js';
import { resolveRepositoryGitPolicy } from '../../services/git/git-policy-source.service.js';
import { getGitTree } from '../../services/git/git-tree.service.js';
import {
  getPackageManifest,
  isWorkspacePath,
  type PackageRef,
} from '../../services/packages/package.service.js';
import {
  findConfiguredRepository,
  findRepositories,
  getRepositoryDetails,
  type Repository,
} from '../../services/repositories/repositories.service.js';
import {
  getDeploymentEnvironments,
  type RepositoryConfigurationErrors,
  type RepositoryEnvironments,
  type RepositoryUrls,
} from '../../services/repositories/repository-config.service.js';
import { isPushLocked } from '../../services/settings/settings.service.js';
import { getRepositoryWorkflows } from '../../services/workflows/workflows.service.js';

export const getRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & {
    repositoryUrls: RepositoryUrls;
    repositoryHosting: RepositoryUrls;
    repositoryEnvironments: RepositoryEnvironments;
    repositoryConfigurationErrors: RepositoryConfigurationErrors;
    repositoryGitPolicies: RepositoryGitPolicies;
    checks: GitChecksService;
    pushLocks?: () => PushLocks;
  }
> = async (app, options) => {
  const withRepositoryConfiguration = async (
    repository: Repository,
  ): Promise<RepositoryResponse> => ({
    ...repository,
    gitPolicy: await resolveRepositoryGitPolicy(
      repository.path,
      repositoryGitPolicy(repository.path, options.repositoryGitPolicies),
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
      const policy = await resolveRepositoryGitPolicy(
        repository.path,
        repositoryGitPolicy(repository.path, options.repositoryGitPolicies),
      );
      const locks = options.pushLocks?.();
      return {
        path: repository.path,
        branches: await Promise.all(
          result.branches.map(async (branch) => {
            const checks = await options.checks.assessChecks(
              repository.path,
              branch.name,
              policy,
            );
            const assessed = assessBranchPush(
              policy,
              branch.name,
              true,
              checks.checksId !== null ? true : (checks.reason ?? false),
            );
            return {
              ...branch,
              checksId: checks.checksId,
              ...assessed,
              ...(locks &&
                isPushLocked(locks, repository.path, branch.name) && {
                  pushAssessment: {
                    state: 'blocked' as const,
                    canAttempt: false as const,
                    reasons: [
                      {
                        code: 'PUSH_LOCKED' as const,
                        message:
                          'Push to this branch is locked in Pulsepit settings.',
                      },
                    ],
                  },
                }),
            };
          }),
        ),
      } satisfies BranchesResponse;
    },
  );

  app.get<{ Querystring: { path: string } }>(
    '/git-tree',
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
      try {
        return {
          path: repository.path,
          ...(await getGitTree(repository.path)),
        } satisfies GitTreeResponse;
      } catch (error) {
        const timeout = (error as { killed?: boolean }).killed === true;
        return reply.code(timeout ? 504 : 502).send({
          error: timeout ? 'Git command timed out.' : 'Unable to read Git log.',
          code: timeout ? 'TIMEOUT' : 'GIT_FAILED',
        } satisfies ErrorResponse);
      }
    },
  );

  app.get<{
    Querystring: { path: string; ref?: PackageRef; workspace?: string };
  }>(
    '/package',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1 },
            ref: { type: 'string', enum: ['head', 'main', 'develop'] },
            workspace: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { path, ref = 'head', workspace } = request.query;
      if (workspace !== undefined && !isWorkspacePath(workspace)) {
        return reply.code(400).send({ error: 'Invalid workspace path.' });
      }
      const repository = await findConfiguredRepository(
        path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }

      const result = await getPackageManifest(repository.path, ref, workspace);
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
