import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { getRepositoriesRoutes } from './get-repositories.routes.js';
import { postRepositoriesRoutes } from './post-repositories.routes.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'>
> = async (app, options) => {
  app.register(getRepositoriesRoutes, { scanPaths: options.scanPaths });
  app.register(postRepositoriesRoutes, { scanPaths: options.scanPaths });
};
