import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { healthRoutes } from './routes/health.routes.js';
import { repositoriesRoutes } from './routes/repositories.routes.js';

export function buildApp(config: AppConfig) {
  const app = Fastify({ logger: true });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(repositoriesRoutes, {
    prefix: '/api',
    scanPaths: config.scanPaths,
  });

  return app;
}
