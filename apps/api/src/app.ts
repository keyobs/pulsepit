import Fastify from 'fastify';
import { healthRoutes } from './routes/health.routes.js';
import { repositoriesRoutes } from './routes/repositories.routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(repositoriesRoutes, { prefix: '/api' });

  return app;
}
