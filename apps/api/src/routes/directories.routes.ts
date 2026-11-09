import type { FastifyPluginAsync } from 'fastify';
import {
  DirectoryListError,
  listDirectories,
} from '../services/directories/directories.service.js';

export const directoriesRoutes: FastifyPluginAsync<{ home?: string }> = async (
  app,
  { home },
) => {
  app.get<{ Querystring: { path?: string } }>(
    '/fs/directories',
    async (request, reply) => {
      try {
        return await listDirectories(request.query.path, home);
      } catch (error) {
        if (!(error instanceof DirectoryListError)) throw error;
        return reply
          .code(error.status)
          .send({ error: error.message, code: error.code });
      }
    },
  );
};
