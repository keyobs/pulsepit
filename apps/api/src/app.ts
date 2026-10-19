import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { healthRoutes } from './routes/health.routes.js';
import { repositoriesRoutes } from './routes/repositories/index.js';
import type { RepositoryUrls } from './services/repository-config.service.js';

export function buildApp(
  config: AppConfig,
  repositoryUrls: RepositoryUrls = {},
  repositoryHosting: RepositoryUrls = {},
) {
  const app = Fastify({ logger: true });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(repositoriesRoutes, {
    prefix: '/api/repositories',
    scanPaths: config.scanPaths,
    repositoryUrls,
    repositoryHosting,
  });

  return app;
}
