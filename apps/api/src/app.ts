import Fastify from 'fastify';
import { healthRoutes } from './routes/health.routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(healthRoutes, { prefix: '/api' });

  return app;
}
