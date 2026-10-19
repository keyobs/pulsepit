import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { fetchRepository } from '../../services/git.service.js';
import { pushRepositoryBranch } from '../../services/git-push.service.js';
import { getOutdatedDependencies } from '../../services/outdated.service.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';

export const postRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.post<{ Body: { path: string; branch: string } }>(
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
      const result = await pushRepositoryBranch(repository.path, branch);
      if (!result.success) {
        const status =
          result.code === 'INVALID_BRANCH'
            ? 400
            : result.code === 'BRANCH_NOT_FOUND'
              ? 404
              : result.code === 'REMOTE_NOT_FOUND'
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
      return { path: repository.path, branch, remote: 'origin', success: true };
    },
  );

  app.post<{ Body: { path: string } }>(
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
      return { path: repository.path, success: true };
    },
  );

  app.post<{ Body: { path: string } }>(
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
        return reply.code(status).send(result);
      }
      return { path: repository.path, ...result };
    },
  );
};
