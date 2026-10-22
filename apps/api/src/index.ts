import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { loadRepositoryDeploymentConfig } from './services/repository-config.service.js';

// Resolve from this file so development and compiled startup use the same .env.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  loadEnvFile(envPath);
} catch (error) {
  // Environment variables can also be supplied directly without a .env file.
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config = readConfig();
const deploymentConfig = await loadRepositoryDeploymentConfig(
  config.configPath,
  { isolateInvalidRepositories: true },
);
const app = buildApp(
  config,
  deploymentConfig.urls,
  deploymentConfig.hosting,
  deploymentConfig.environments,
  deploymentConfig.errors,
  deploymentConfig.gitPolicies,
);

for (const [path, error] of Object.entries(deploymentConfig.errors ?? {})) {
  app.log.warn(
    { path, ...error },
    'Repository deployment configuration disabled.',
  );
}

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

async function shutdown() {
  await app.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
