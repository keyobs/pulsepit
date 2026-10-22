import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  GitBranchPolicy,
  type PushAssessment,
  type PushPolicyReason,
  type RepositoryGitPolicy,
} from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';

const execute = promisify(execFile);
export type RepositoryGitPolicies = Record<string, RepositoryGitPolicy>;
export const unknownBranchPolicy = (): {
  directPush: 'unknown';
  requiredChecks: null;
} => ({ directPush: 'unknown', requiredChecks: null });
export function unconfiguredGitPolicy(): RepositoryGitPolicy {
  return {
    state: 'unconfigured',
    source: null,
    remote: 'origin',
    default: unknownBranchPolicy(),
    branches: {},
    error: null,
  };
}
function invalidGitPolicy(): RepositoryGitPolicy {
  return {
    state: 'invalid',
    source: null,
    remote: 'origin',
    default: unknownBranchPolicy(),
    branches: {},
    error: {
      code: 'INVALID_PUSH_POLICY',
      message: 'Unable to validate repository push policy.',
    },
  };
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('Unknown policy setting.');
}

export async function validateGitPolicyBranchName(
  branch: string,
): Promise<void> {
  if (branch === 'HEAD' || branch.startsWith('-'))
    throw new Error('Invalid branch name.');
  await execute('git', ['check-ref-format', `refs/heads/${branch}`], {
    timeout: 5000,
    maxBuffer: 4096,
    env: createCommandEnvironment('git'),
  });
}

// Parse independently of deployment settings: quarantining a bad deployment
// configuration must never discard a valid push prohibition.
export async function parseRepositoryGitPolicies(
  repositories: Record<string, unknown>,
): Promise<RepositoryGitPolicies> {
  const policies: RepositoryGitPolicies = Object.create(null);
  const seen = new Set<string>();
  for (const [path, settings] of Object.entries(repositories)) {
    if (!isAbsolute(path)) continue;
    const normalized = resolve(path);
    if (seen.has(normalized)) {
      policies[normalized] = invalidGitPolicy();
      continue;
    }
    seen.add(normalized);
    try {
      if (!isObject(settings)) throw new Error('Invalid repository settings.');
      if (settings.git === undefined) continue;
      if (!isObject(settings.git)) throw new Error('Invalid Git settings.');
      onlyKeys(settings.git, ['policy', 'checks']);
      // Runner definitions are private and unused in this tranche. Even a
      // declared runner cannot make a mandatory check executable yet.
      if (settings.git.checks !== undefined && !isObject(settings.git.checks))
        throw new Error('Invalid check definitions.');
      const policy = settings.git.policy;
      if (policy === undefined) continue;
      if (!isObject(policy)) throw new Error('Invalid push policy.');
      onlyKeys(policy, ['default', 'branches']);
      const defaults =
        policy.default === undefined
          ? unknownBranchPolicy()
          : GitBranchPolicy.strict().parse(policy.default);
      const branches = policy.branches ?? {};
      if (!isObject(branches) || policy.branches === null)
        throw new Error('Invalid branch rules.');
      const validated: Record<string, GitBranchPolicy> = Object.create(null);
      for (const [branch, rule] of Object.entries(branches)) {
        await validateGitPolicyBranchName(branch);
        validated[branch] = GitBranchPolicy.strict().parse(rule);
      }
      policies[normalized] = {
        state: 'configured',
        source: 'local-config',
        remote: 'origin',
        default: defaults,
        branches: validated,
        error: null,
      };
    } catch {
      policies[normalized] = invalidGitPolicy();
    }
  }
  return policies;
}

export function repositoryGitPolicy(
  path: string,
  policies: RepositoryGitPolicies,
): RepositoryGitPolicy {
  return Object.hasOwn(policies, path)
    ? policies[path]
    : unconfiguredGitPolicy();
}
export function assessBranchPush(
  repositoryPolicy: RepositoryGitPolicy,
  branch: string,
  gitAvailable = true,
): { policy: GitBranchPolicy; pushAssessment: PushAssessment } {
  const policy =
    repositoryPolicy.state === 'configured'
      ? Object.hasOwn(repositoryPolicy.branches, branch)
        ? repositoryPolicy.branches[branch]
        : repositoryPolicy.default
      : unknownBranchPolicy();
  const blocked = (
    code: PushPolicyReason['code'],
    message: string,
  ): { policy: GitBranchPolicy; pushAssessment: PushAssessment } => ({
    policy,
    pushAssessment: {
      state: 'blocked',
      canAttempt: false,
      reasons: [{ code, message }],
    },
  });
  if (repositoryPolicy.state === 'invalid')
    return blocked('INVALID_PUSH_POLICY', repositoryPolicy.error.message);
  if (policy.directPush === 'forbidden')
    return blocked(
      'DIRECT_PUSH_FORBIDDEN',
      'Direct push to this branch is forbidden by the repository policy.',
    );
  if (policy.requiredChecks?.length)
    return blocked(
      'CHECK_RUNNER_UNAVAILABLE',
      'Required checks cannot be run by this server.',
    );
  if (!gitAvailable)
    return {
      policy,
      pushAssessment: {
        state: 'unknown',
        canAttempt: false,
        reasons: [
          {
            code: 'GIT_STATE_UNAVAILABLE',
            message: 'Git state required to assess the push is unavailable.',
          },
        ],
      },
    };
  if (repositoryPolicy.state === 'unconfigured')
    return {
      policy,
      pushAssessment: {
        state: 'unknown',
        canAttempt: true,
        reasons: [
          {
            code: 'POLICY_UNCONFIGURED',
            message:
              'No local push policy is configured. Existing Git hooks still apply.',
          },
        ],
      },
    };
  if (policy.directPush === 'unknown' || policy.requiredChecks === null)
    return {
      policy,
      pushAssessment: {
        state: 'unknown',
        canAttempt: true,
        reasons: [
          {
            code: 'POLICY_INCOMPLETE',
            message:
              'The local push policy is partially unknown. Existing Git hooks still apply.',
          },
        ],
      },
    };
  return {
    policy,
    pushAssessment: { state: 'ready', canAttempt: true, reasons: [] },
  };
}
