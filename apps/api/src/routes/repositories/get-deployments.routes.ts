import type { DeploymentsResponse, ErrorResponse } from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { collectDeploymentDates } from '../../services/deployment-date.service.js';
import { collectDeploymentMetadata } from '../../services/deployment-metadata.service.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';
import {
  getDeploymentEnvironments,
  getDeploymentDateSources,
  getDeploymentMetadataSources,
  type RepositoryEnvironments,
  type RepositoryUrls,
} from '../../services/repository-config.service.js';

export const getDeploymentsRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths' | 'githubToken'> & {
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
      const metadata = await collectDeploymentMetadata(
          environments,
          getDeploymentMetadataSources(
            repository.path,
            options.repositoryEnvironments,
          ),
      );
      return {
        path: repository.path,
        environments: await collectDeploymentDates(
          repository.path,
          metadata,
          getDeploymentDateSources(repository.path, options.repositoryEnvironments),
          options.githubToken,
        ),
      } satisfies DeploymentsResponse;
    },
  );
};
