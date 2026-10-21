import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { healthRoutes } from './routes/health.routes.js';
import { repositoriesRoutes } from './routes/repositories/index.js';
import type {
  RepositoryEnvironments,
  RepositoryUrls,
} from './services/repository-config.service.js';

export function buildApp(
  config: AppConfig,
  repositoryUrls: RepositoryUrls = {},
  repositoryHosting: RepositoryUrls = {},
  repositoryEnvironments: RepositoryEnvironments = {},
) {
  const app = Fastify({ logger: true });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(repositoriesRoutes, {
    prefix: '/api/repositories',
    scanPaths: config.scanPaths,
    githubToken: config.githubToken,
    repositoryUrls,
    repositoryHosting,
    repositoryEnvironments,
  });

  return app;
}
