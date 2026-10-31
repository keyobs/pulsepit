import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { healthRoutes } from './routes/health.routes.js';
import { repositoriesRoutes } from './routes/repositories/index.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { BeaconMonitoringService } from './services/beacon/beacon-monitoring.service.js';
import type { RepositoryGitPolicies } from './services/git/git-policy.service.js';
import { GitRescanService } from './services/git/git-rescan.service.js';
import type {
  RepositoryConfigurationErrors,
  RepositoryEnvironments,
  RepositoryUrls,
} from './services/repositories/repository-config.service.js';
import { SettingsStore } from './services/settings/settings.service.js';

export function buildApp(
  config: AppConfig,
  repositoryUrls: RepositoryUrls = {},
  repositoryHosting: RepositoryUrls = {},
  repositoryEnvironments: RepositoryEnvironments = {},
  repositoryConfigurationErrors: RepositoryConfigurationErrors = {},
  repositoryGitPolicies: RepositoryGitPolicies = {},
) {
  const app = Fastify({ logger: true });
  const settings = new SettingsStore(
    config.scanPaths,
    config.configPath
      ? join(dirname(config.configPath), 'settings.json')
      : undefined,
  );
  const rescan = new GitRescanService(config.scanPaths);
  app.addHook('onReady', async () => {
    const warning = await settings.load();
    if (warning) app.log.warn(warning);
    rescan.configure(settings.settings.rescan);
  });
  app.addHook('onClose', () => rescan.close());

  const monitoring = new BeaconMonitoringService(
    config.scanPaths,
    repositoryEnvironments,
    repositoryConfigurationErrors,
  );
  app.addHook('onReady', () => monitoring.start());
  app.addHook('onClose', () => monitoring.close());
  app.get('/api/monitoring', () => monitoring.snapshot());

  app.register(healthRoutes, { prefix: '/api' });
  app.register(settingsRoutes, { prefix: '/api', settings, rescan });
  app.register(repositoriesRoutes, {
    prefix: '/api/repositories',
    scanPaths: config.scanPaths,
    configPath: config.configPath,
    githubToken: config.githubToken,
    vercelToken: config.vercelToken,
    repositoryUrls,
    repositoryHosting,
    repositoryEnvironments,
    repositoryConfigurationErrors,
    repositoryGitPolicies,
    pushLocks: () => settings.settings.pushLocks,
  });

  return app;
}
