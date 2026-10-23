import type { PushRequest } from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../../config.js';
import {
  ChecksRequestError,
  GitChecksService,
} from '../../services/git/git-checks.service.js';
import type { RepositoryGitPolicies } from '../../services/git/git-policy.service.js';
import { findConfiguredRepository } from '../../services/repositories/repositories.service.js';

const pathProperty = { type: 'string', minLength: 1, pattern: '\\S' };
export const checksRoutes: FastifyPluginAsync<
  Pick<AppConfig, 'scanPaths'> & {
    repositoryGitPolicies: RepositoryGitPolicies;
  }
> = async (app, options) => {
  const runner = new GitChecksService(options.repositoryGitPolicies);
  app.addHook('onClose', () => runner.close());
  app.post<{ Body: PushRequest }>(
    '/checks',
    {
      preValidation: async (request, reply) => {
        if (
          request.body &&
          typeof request.body === 'object' &&
          Object.keys(request.body).some(
            (key) => !['path', 'branch'].includes(key),
          )
        )
          return reply
            .code(400)
            .send({ error: 'Only path and branch are accepted.' });
      },
      schema: {
        body: {
          type: 'object',
          required: ['path', 'branch'],
          additionalProperties: false,
          properties: { path: pathProperty, branch: pathProperty },
        },
      },
    },
    async (request, reply) => {
      const repository = await findConfiguredRepository(
        request.body.path,
        options.scanPaths,
      );
      if (!repository)
        return reply.code(404).send({
          error: 'Repository not found in configured scan directories.',
        });
      try {
        const operation = await runner.start(
          repository.path,
          request.body.branch,
        );
        return reply
          .code(202)
          .header(
            'Location',
            `/api/repositories/checks/${operation.id}?${new URLSearchParams({ path: repository.path })}`,
          )
          .send(operation);
      } catch (error) {
        if (error instanceof ChecksRequestError)
          return reply
            .code(error.status)
            .send({ code: error.code, error: error.message });
        return reply.code(502).send({
          code: 'CHECKS_FAILED',
          error: 'Unable to start repository checks.',
        });
      }
    },
  );
  const schema = {
    params: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', pattern: '^[a-f0-9-]{36}$' } },
    },
    querystring: {
      type: 'object',
      required: ['path'],
      properties: { path: pathProperty },
    },
  };
  for (const cancel of [false, true]) {
    app.route<{ Params: { id: string }; Querystring: { path: string } }>({
      method: cancel ? 'POST' : 'GET',
      url: `/checks/:id${cancel ? '/cancel' : ''}`,
      schema,
      handler: async (request, reply) => {
        const repository = await findConfiguredRepository(
          request.query.path,
          options.scanPaths,
        );
        if (!repository)
          return reply.code(404).send({
            error: 'Repository not found in configured scan directories.',
          });
        const operation = cancel
          ? runner.cancel(request.params.id, repository.path)
          : runner.get(request.params.id, repository.path);
        if (!operation)
          return reply.code(404).send({
            code: 'CHECKS_NOT_FOUND',
            error: 'Check operation not found for this repository.',
          });
        return operation;
      },
    });
  }
};
