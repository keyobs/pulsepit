import { resolve } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../config.js';
import {
  getPackageManifest,
  type PackageRef,
} from '../services/package.service.js';
import { findRepositories } from '../services/repositories.service.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.get('/repositories', async () => {
    return findRepositories(options.scanPaths);
  });

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
      const { repositories } = await findRepositories(options.scanPaths);
      const repository = repositories.find(
        (repo) => repo.path === resolve(path),
      );
      if (!repository) {
        return reply
          .code(404)
          .send({
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
