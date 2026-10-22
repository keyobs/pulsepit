import { simpleGit } from 'simple-git';
import { createCommandEnvironment } from './command-environment.service.js';

export function createGitClient(repositoryPath: string) {
  const environment = createCommandEnvironment('git');
  const names = new Set(
    Object.keys(environment).map((name) => name.toUpperCase()),
  );
  return simpleGit({
    baseDir: repositoryPath,
    timeout: { block: 10_000 },
    allowEnvironment: Object.keys(environment),
    // Both simple-git guards must accept the explicitly retained Git settings.
    unsafe: {
      allowUnsafeAskPass: names.has('GIT_ASKPASS') || names.has('SSH_ASKPASS'),
      allowUnsafeSshCommand:
        names.has('GIT_SSH') || names.has('GIT_SSH_COMMAND'),
      allowUnsafeConfigPaths:
        names.has('GIT_CONFIG_GLOBAL') || names.has('GIT_CONFIG_SYSTEM'),
    },
  }).env(environment);
}
