import type { SettingsResponse } from '@pulsepit/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { GitRescanService } from '../services/git/git-rescan.service.js';
import {
  type SettingsStore,
  SettingsValidationError,
} from '../services/settings/settings.service.js';

export const settingsRoutes: FastifyPluginAsync<{
  settings: SettingsStore;
  rescan: GitRescanService;
}> = async (app, { settings, rescan }) => {
  const describe = (): SettingsResponse => ({
    ...settings.describe(),
    rescan: rescan.snapshot(),
  });

  app.get('/settings', async () => describe());

  app.put('/settings', async (request, reply) => {
    try {
      const saved = await settings.save(request.body);
      rescan.configure(saved.rescan);
    } catch (error) {
      if (error instanceof SettingsValidationError)
        return reply
          .code(422)
          .send({ error: error.message, field: error.field });
      request.log.error(error);
      return reply.code(500).send({ error: 'Unable to save settings.' });
    }
    return describe();
  });
};
