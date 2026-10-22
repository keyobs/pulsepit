import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import type {
  RepositoryConfigurationErrors,
  RepositoryEnvironments,
  RepositoryUrls,
} from '../../services/repository-config.service.js';
import { getDeploymentsRoutes } from './get-deployments.routes.js';
import { getGithubActionsRoutes } from './get-github-actions.routes.js';
import { getHooksRoutes } from './get-hooks.routes.js';
import { getRepositoriesRoutes } from './get-repositories.routes.js';
import { postRepositoriesRoutes } from './post-repositories.routes.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths' | 'githubToken' | 'vercelToken'> & {
    repositoryUrls: RepositoryUrls;
    repositoryHosting: RepositoryUrls;
    repositoryEnvironments: RepositoryEnvironments;
    repositoryConfigurationErrors: RepositoryConfigurationErrors;
  }
> = async (app, options) => {
  app.register(getHooksRoutes, { scanPaths: options.scanPaths });
  app.register(getDeploymentsRoutes, {
    scanPaths: options.scanPaths,
    githubToken: options.githubToken,
    vercelToken: options.vercelToken,
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
    repositoryConfigurationErrors: options.repositoryConfigurationErrors,
  });
  app.register(postRepositoriesRoutes, {
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
  });
};
