import type { FastifyPluginAsync } from 'fastify';
import { findRepositories } from '../services/repositories.service.js';

export const repositoriesRoutes: FastifyPluginAsync = async (app) => {
  // Configure the parent folder when starting the API.
  const scanPath = process.env.SCAN_PATH;
  console.log(scanPath)

  app.get('/repositories', async (_request, reply) => {
    if (!scanPath) {
      return reply.code(503).send({
        error:
          'Configure SCAN_PATH with a directory path or a JSON array of directory paths.',
      });
    }

    let paths: unknown = scanPath;
    if (scanPath.trimStart().startsWith('[')) {
      try {
        paths = JSON.parse(scanPath);
      } catch {
        return reply.code(503).send({
          error:
            'SCAN_PATH must contain a valid JSON array of directory paths.',
        });
      }
    }

    const directories = Array.isArray(paths) ? paths : [paths];
    if (
      directories.length === 0 ||
      !directories.every(
        (path): path is string =>
          typeof path === 'string' && path.trim().length > 0,
      )
    ) {
      return reply.code(503).send({
        error:
          'SCAN_PATH must contain a non-empty directory path or a non-empty JSON array of directory paths.',
      });
    }

    const repositories = await findRepositories(directories);
    return { repositories };
  });
};
