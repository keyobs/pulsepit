import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../config.js';
import { findRepositories } from '../services/repositories.service.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.get('/repositories', async () => {
    return findRepositories(options.scanPaths);
  });
};
