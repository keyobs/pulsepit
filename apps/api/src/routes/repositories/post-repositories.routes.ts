import type {
  ErrorResponse,
  FetchRequest,
  FetchResponse,
  MonitoringRequest,
  MonitoringResponse,
  OutdatedRequest,
  OutdatedResponse,
  PushRequest,
  PushResponse,
} from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { fetchRepository } from '../../services/git.service.js';
import {
  type RepositoryGitPolicies,
  repositoryGitPolicy,
} from '../../services/git-policy.service.js';
import { pushRepositoryBranch } from '../../services/git-push.service.js';
import { checkDeploymentUrls } from '../../services/monitoring.service.js';
import { getOutdatedDependencies } from '../../services/outdated.service.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';
import type { RepositoryUrls } from '../../services/repository-config.service.js';

export const postRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & {
    repositoryUrls: RepositoryUrls;
    repositoryGitPolicies: RepositoryGitPolicies;
  }
> = async (app, options) => {
  app.post<{ Body: MonitoringRequest }>(
    '/monitoring',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
            environment: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const repository = await findConfiguredRepository(
        request.body.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }
      const urls = options.repositoryUrls[repository.path] ?? {};
      const { environment } = request.body;
      if (environment !== undefined && !Object.hasOwn(urls, environment)) {
        return reply.code(404).send({
          code: 'ENVIRONMENT_NOT_FOUND',
          error: 'No application URL is configured for this environment.',
        } satisfies ErrorResponse);
      }
      const selected =
        environment === undefined
          ? urls
          : Object.fromEntries([[environment, urls[environment]]]);
      const result = await checkDeploymentUrls(selected);
      return { path: repository.path, ...result } satisfies MonitoringResponse;
    },
  );

  app.post<{ Body: PushRequest }>(
    '/push',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'branch'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
            branch: { type: 'string', minLength: 1, pattern: '\\S' },
          },
        },
      },
    },
    async (request, reply) => {
      const { path, branch } = request.body;
      const repository = await findConfiguredRepository(
        path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }
      const result = await pushRepositoryBranch(
        repository.path,
        branch,
        repositoryGitPolicy(repository.path, options.repositoryGitPolicies),
      );
      if (!result.success) {
        const status =
          result.code === 'DIRECT_PUSH_FORBIDDEN'
            ? 403
            : result.code === 'INVALID_PUSH_POLICY' ||
                result.code === 'CHECK_RUNNER_UNAVAILABLE' ||
                result.code === 'GIT_STATE_UNAVAILABLE'
              ? 422
              : result.code === 'INVALID_BRANCH'
                ? 400
                : result.code === 'BRANCH_NOT_FOUND'
                  ? 404
                  : result.code === 'REMOTE_NOT_FOUND' ||
                      result.code === 'LOCAL_HOOK_FAILED'
                    ? 422
                    : result.code === 'NON_FAST_FORWARD' ||
                        result.code === 'REMOTE_REJECTED'
                      ? 409
                      : result.code === 'TIMEOUT'
                        ? 504
                        : 502;
        return reply
          .code(status)
          .send({ path: repository.path, branch, ...result });
      }
      return {
        path: repository.path,
        branch,
        remote: 'origin',
        success: true,
      } satisfies PushResponse;
    },
  );

  app.post<{ Body: FetchRequest }>(
    '/fetch',
    {
      schema: {
        body: {
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
        request.body.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }
      const result = await fetchRepository(repository.path);
      if (!result.success) {
        return reply
          .code(result.code === 'TIMEOUT' ? 504 : 502)
          .send({ path: repository.path, ...result });
      }
      return { path: repository.path, success: true } satisfies FetchResponse;
    },
  );

  app.post<{ Body: OutdatedRequest }>(
    '/outdated',
    {
      schema: {
        body: {
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
        request.body.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      }

      const result = await getOutdatedDependencies(repository.path);
      if (result.error !== null) {
        const status =
          result.code === 'PACKAGE_MANAGER'
            ? 422
            : result.code === 'TIMEOUT'
              ? 504
              : 502;
        return reply.code(status).send({ path: repository.path, ...result });
      }
      return { path: repository.path, ...result } satisfies OutdatedResponse;
    },
  );
};
