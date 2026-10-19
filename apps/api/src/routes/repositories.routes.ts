import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../config.js';
import { fetchRepository } from '../services/git.service.js';
import { getOutdatedDependencies } from '../services/outdated.service.js';
import {
  getPackageManifest,
  type PackageRef,
} from '../services/package.service.js';
import {
  findConfiguredRepository,
  findRepositories,
} from '../services/repositories.service.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.get('/repositories', async () => {
    return findRepositories(options.scanPaths);
  });

  app.post<{ Body: { path: string } }>(
    '/repositories/fetch',
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
    '/repositories/outdated',
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

  app.get<{ Querystring: { path: string; ref?: PackageRef } }>(
    '/repositories/package',
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
      return { path: repository.path, ref, manifest: result.manifest };
    },
  );
};
