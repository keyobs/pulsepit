import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { RepositoryUrls } from '../../services/repository-config.service.js';
import { getRepositoriesRoutes } from './get-repositories.routes.js';
import { postRepositoriesRoutes } from './post-repositories.routes.js';

export const repositoriesRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & { repositoryUrls: RepositoryUrls }
> = async (app, options) => {
  app.register(getRepositoriesRoutes, {
    scanPaths: options.scanPaths,
    repositoryUrls: options.repositoryUrls,
  });
  app.register(postRepositoriesRoutes, { scanPaths: options.scanPaths });
};
