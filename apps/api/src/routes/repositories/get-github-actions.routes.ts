import type {
  ErrorResponse,
  GithubActionsRunsResponse,
} from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import { getOriginRemote } from '../../services/git-origin.service.js';
import { getGithubActionsRuns } from '../../services/github-actions.service.js';
import { findConfiguredRepository } from '../../services/repositories.service.js';

export const getGithubActionsRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths' | 'githubToken'>
> = async (app, options) => {
  app.get<{
    Querystring: { path: string; branch?: string; limit?: number };
  }>(
    '/github/actions/runs',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, pattern: '\\S' },
            branch: { type: 'string', minLength: 1, pattern: '\\S' },
            limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const repository = await findConfiguredRepository(
        request.query.path,
        options.scanPaths,
      );
      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        } satisfies ErrorResponse);
      }
      const { origin, originError } = await getOriginRemote(repository.path);
      if (originError !== null) {
        return reply.code(502).send({
          code: 'ORIGIN_READ_FAILED',
          error: 'Unable to read the repository origin.',
        } satisfies ErrorResponse);
      }
      if (!origin?.github) {
        return reply.code(422).send({
          code: 'GITHUB_ORIGIN_REQUIRED',
          error: 'A github.com origin is required to read GitHub Actions runs.',
        } satisfies ErrorResponse);
      }
      const { branch, limit = 10 } = request.query;
      const result = await getGithubActionsRuns(origin.github, {
        branch,
        limit,
        token: options.githubToken,
      });
      if (!result.ok) return reply.code(result.statusCode).send(result.error);
      return {
        path: repository.path,
        repository: origin.github,
        branch: branch ?? null,
        limit,
        ...result.data,
      } satisfies GithubActionsRunsResponse;
    },
  );
};
