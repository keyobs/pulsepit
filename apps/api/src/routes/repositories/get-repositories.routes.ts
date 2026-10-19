import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { getLocalBranches } from '../../services/git.service.js';
import { getOriginRemote } from '../../services/git-origin.service.js';
import {
  getPackageManifest,
  type PackageRef,
} from '../../services/package.service.js';
import {
  findConfiguredRepository,
  findRepositories,
} from '../../services/repositories.service.js';
import type { RepositoryUrls } from '../../services/repository-config.service.js';
import { getRepositoryWorkflows } from '../../services/workflows.service.js';

export const getRepositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & {
    repositoryUrls: RepositoryUrls;
    repositoryHosting: RepositoryUrls;
  }
> = async (app, options) => {
  app.get('', async () => {
    const result = await findRepositories(options.scanPaths);
    return {
      ...result,
      repositories: result.repositories.map((repository) => ({
        ...repository,
        urls: options.repositoryUrls[repository.path] ?? {},
        hosting: options.repositoryHosting[repository.path] ?? {},
      })),
    };
  });

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
      };
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
      };
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
      return { path: repository.path, branches: result.branches };
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
      return { path: repository.path, ref, manifest: result.manifest };
    },
  );
};
