import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import {
  getPackageManifest,
  type PackageRef,
} from '../../services/package.service.js';
import {
  findConfiguredRepository,
  findRepositories,
} from '../../services/repositories.service.js';

export const getRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.get('', async () => {
    return findRepositories(options.scanPaths);
  });

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
      return { path: repository.path, ref, manifest: result.manifest };
    },
  );
};
