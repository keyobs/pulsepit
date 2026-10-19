import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { fetchRepository } from '../../services/git.service.js';
import { getOutdatedDependencies } from '../../services/outdated.service.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';

export const postRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
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
