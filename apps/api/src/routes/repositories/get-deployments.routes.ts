import type { DeploymentsResponse, ErrorResponse } from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { collectDeploymentMetadata } from '../../services/beacon/deployment-metadata.service.js';
import { collectDeploymentComparisons } from '../../services/deployments/deployment-comparison.service.js';
import { collectDeploymentDates } from '../../services/deployments/deployment-date.service.js';
import { findConfiguredRepository } from '../../services/repositories/repositories.service.js';
import {
  getDeploymentDateSources,
  getDeploymentEnvironments,
  getDeploymentMetadataSources,
  type RepositoryEnvironments,
  type RepositoryUrls,
} from '../../services/repositories/repository-config.service.js';

export const getDeploymentsRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths' | 'githubToken' | 'vercelToken'> & {
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
      const dated = await collectDeploymentDates(
        repository.path,
        metadata,
        getDeploymentDateSources(
          repository.path,
          options.repositoryEnvironments,
        ),
        {
          githubToken: options.githubToken,
          vercelToken: options.vercelToken,
        },
      );
      return {
        path: repository.path,
        environments: await collectDeploymentComparisons(
          repository.path,
          dated,
        ),
      } satisfies DeploymentsResponse;
    },
  );
};
