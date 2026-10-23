import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { GitChecksService } from '../../services/git/git-checks.service.js';
import type { RepositoryGitPolicies } from '../../services/git/git-policy.service.js';
import type {
  RepositoryConfigurationErrors,
  RepositoryEnvironments,
  RepositoryUrls,
} from '../../services/repositories/repository-config.service.js';
import { checksRoutes } from './checks.routes.js';
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
    repositoryGitPolicies: RepositoryGitPolicies;
  }
> = async (app, options) => {
  const checks = new GitChecksService(options.repositoryGitPolicies);
  app.addHook('onClose', () => checks.close());
  app.register(checksRoutes, {
    checks,
    scanPaths: options.scanPaths,
    repositoryGitPolicies: options.repositoryGitPolicies,
  });
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
    checks,
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
    repositoryHosting: options.repositoryHosting,
    repositoryEnvironments: options.repositoryEnvironments,
    repositoryConfigurationErrors: options.repositoryConfigurationErrors,
    repositoryGitPolicies: options.repositoryGitPolicies,
  });
  app.register(postRepositoriesRoutes, {
    checks,
    repositoryGitPolicies: options.repositoryGitPolicies,
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
  });
};
