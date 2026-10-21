import type { DeploymentsResponse, ErrorResponse } from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';
import {
  getDeploymentEnvironments,
  type RepositoryEnvironments,
  type RepositoryUrls,
} from '../../services/repository-config.service.js';

export const getDeploymentsRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & {
    repositoryEnvironments: RepositoryEnvironments;
    repositoryUrls: RepositoryUrls;
    repositoryHosting: RepositoryUrls;
  }
> = async (app, options) => {
  app.get<{ Querystring: { path: string } }>(
    '/deployments',
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
      const environments = getDeploymentEnvironments(
        repository.path,
        options.repositoryEnvironments,
        options.repositoryUrls,
        options.repositoryHosting,
      );
      return {
        path: repository.path,
        environments: environments.map((environment) => ({
          ...environment,
          deployedAt: null,
          deploymentSource: null,
          metadataCheckedAt: null,
          metadataError: null,
        })),
      } satisfies DeploymentsResponse;
    },
  );
};
