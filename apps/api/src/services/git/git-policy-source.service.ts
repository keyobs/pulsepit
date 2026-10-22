import type { RepositoryGitPolicy } from '@pulsepit/contracts';
import {
  invalidGitPolicy,
  unconfiguredGitPolicy,
} from './git-policy.service.js';
import { readRepositoryGitPolicyFile } from './git-policy-file.service.js';

export async function resolveRepositoryGitPolicy(
  repositoryPath: string,
  localPolicy: RepositoryGitPolicy = unconfiguredGitPolicy(),
): Promise<RepositoryGitPolicy> {
  if (localPolicy.state === 'invalid') return localPolicy;
  const file = await readRepositoryGitPolicyFile(repositoryPath);
  if (file.state === 'missing') return localPolicy;
  if (file.state === 'invalid') return invalidGitPolicy(file.error.message);
  if (localPolicy.state === 'configured')
    return invalidGitPolicy(
      'Both a local push policy and a repository declaration are configured. Keep only one policy source.',
    );
  return {
    state: 'configured',
    source: 'repository-file',
    remote: file.declaration.remote,
    default: file.declaration.default,
    branches: file.declaration.branches,
    error: null,
  };
}
