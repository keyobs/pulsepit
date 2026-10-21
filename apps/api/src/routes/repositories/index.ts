import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import type {
  RepositoryEnvironments,
  RepositoryUrls,
} from '../../services/repository-config.service.js';
import { getDeploymentsRoutes } from './get-deployments.routes.js';
import { getGithubActionsRoutes } from './get-github-actions.routes.js';
import { getRepositoriesRoutes } from './get-repositories.routes.js';
import { postRepositoriesRoutes } from './post-repositories.routes.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths' | 'githubToken'> & {
    repositoryUrls: RepositoryUrls;
    repositoryHosting: RepositoryUrls;
    repositoryEnvironments: RepositoryEnvironments;
  }
> = async (app, options) => {
  app.register(getDeploymentsRoutes, {
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
    repositoryHosting: options.repositoryHosting,
    repositoryEnvironments: options.repositoryEnvironments,
  });
  app.register(getGithubActionsRoutes, {
    scanPaths: options.scanPaths,
    githubToken: options.githubToken,
  });
  app.register(getRepositoriesRoutes, {
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
    repositoryHosting: options.repositoryHosting,
    repositoryEnvironments: options.repositoryEnvironments,
  });
  app.register(postRepositoriesRoutes, {
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
  });
};
