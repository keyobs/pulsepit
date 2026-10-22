import type {
  ErrorResponse,
  RepositoryHooksResponse,
} from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { inspectRepositoryHooks } from '../../services/git-hooks.service.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';

export const getHooksRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.get<{ Querystring: { path: string } }>(
    '/hooks',
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
      if (repository === null) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        } satisfies ErrorResponse);
      }
      return {
        path: repository.path,
        ...(await inspectRepositoryHooks(repository.path)),
      } satisfies RepositoryHooksResponse;
    },
  );
};
