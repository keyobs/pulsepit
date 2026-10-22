import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { healthRoutes } from './routes/health.routes.js';
import { repositoriesRoutes } from './routes/repositories/index.js';
import type { RepositoryGitPolicies } from './services/git/git-policy.service.js';
import type {
  RepositoryConfigurationErrors,
  RepositoryEnvironments,
  RepositoryUrls,
} from './services/repositories/repository-config.service.js';

export function buildApp(
  config: AppConfig,
  repositoryUrls: RepositoryUrls = {},
  repositoryHosting: RepositoryUrls = {},
  repositoryEnvironments: RepositoryEnvironments = {},
  repositoryConfigurationErrors: RepositoryConfigurationErrors = {},
  repositoryGitPolicies: RepositoryGitPolicies = {},
) {
  const app = Fastify({ logger: true });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(repositoriesRoutes, {
    prefix: '/api/repositories',
    scanPaths: config.scanPaths,
    githubToken: config.githubToken,
    vercelToken: config.vercelToken,
    repositoryUrls,
    repositoryHosting,
    repositoryEnvironments,
    repositoryConfigurationErrors,
    repositoryGitPolicies,
  });

  return app;
}
