import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type {
  ChecksOperation,
  PushPolicyCode,
  PushPolicyReason,
  RepositoryGitPolicy,
} from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';
import { GitChecksHistory } from './git-checks-history.service.js';
import {
  type ChecksEvidence,
  checksAdapterDigest,
  checksAdapterPath,
  createChecksProof,
  managedChecksHook,
  verifyChecksContext,
} from './git-checks-proof.service.js';
import {
  type RepositoryGitPolicies,
  repositoryGitPolicy,
  unconfiguredGitPolicy,
  validateGitPolicyBranchName,
} from './git-policy.service.js';
import { resolveRepositoryGitPolicy } from './git-policy-source.service.js';
import {
  type GitPushResult,
  pushRepositoryBranch,
} from './git-push.service.js';

const execute = promisify(execFile);
const now = () => new Date().toISOString();
const terminal = (value: ChecksOperation) =>
  !['queued', 'running'].includes(value.status);
export class ChecksRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
type Job = {
  value: ChecksOperation;
  policy: RepositoryGitPolicy;
  child?: ChildProcess;
  done: Promise<void>;
  resolve: () => void;
  evidence?: ChecksEvidence;
  adapterDigest?: string;
  used?: boolean;
  restored?: boolean;
};

export class GitChecksService {
  private jobs = new Map<string, Job>();
  private locks = new Map<string, string>();
  private closed = false;
  private keys = generateKeyPairSync('ed25519');
  private pushes = new Set<Promise<GitPushResult>>();
  private history?: GitChecksHistory;
  constructor(
    private policies: RepositoryGitPolicies = {},
    private options: {
      timeoutMs?: number;
      historyFile?: string;
      onHistoryError?: () => void;
    } = {},
  ) {
    if (options.historyFile)
      this.history = new GitChecksHistory(
        options.historyFile,
        options.onHistoryError,
      );
  }
  async restore() {
    if (!this.history) return;
    const operations = await this.history.load();
    for (const value of operations) {
      if (this.jobs.has(value.id)) continue;
      if (!terminal(value)) {
        value.status = 'cancelled';
        value.completedAt = now();
        value.error = {
          code: 'CHECKS_INTERRUPTED',
          message: 'Checks were interrupted by an API restart. Run new checks.',
        };
        for (const check of value.checks) {
          if (['pending', 'running'].includes(check.status)) {
            check.status = 'cancelled';
            check.completedAt = value.completedAt;
          }
        }
      }
      if (value.push?.status === 'running') {
        value.push = {
          ...value.push,
          status: 'failed',
          completedAt: now(),
          error: {
            code: 'PUSH_INTERRUPTED',
            message:
              'Push tracking was interrupted. Verify the remote state before retrying.',
          },
        };
      }
      this.jobs.set(value.id, {
        value,
        policy: unconfiguredGitPolicy(),
        done: Promise.resolve(),
        resolve: () => {},
        used: true,
        restored: true,
      });
    }
    this.prune();
    if (operations.length) await this.persist();
  }
  private persist(): Promise<void> {
    if (!this.history) return Promise.resolve();
    return this.history.save(
      [...this.jobs.values()].map((job) => structuredClone(job.value)),
    );
  }
  private prune(reserved = 0) {
    for (const [id, job] of this.jobs) {
      if (
        terminal(job.value) &&
        job.value.push?.status !== 'running' &&
        job.value.completedAt &&
        (Date.now() - Date.parse(job.value.completedAt) > 15 * 60_000 ||
          this.jobs.size > 100 - reserved)
      )
        this.jobs.delete(id);
    }
  }
  async start(path: string, branch: string): Promise<ChecksOperation> {
    this.prune();
    if (this.closed || this.locks.size >= 2)
      throw new ChecksRequestError(
        503,
        'CHECKS_CAPACITY',
        'The check runner is at capacity.',
      );
    if (this.locks.has(path))
      throw new ChecksRequestError(
        409,
        'CHECKS_BUSY',
        'Checks are already active for this repository.',
      );
    if (branch === 'HEAD' || branch.startsWith('-'))
      throw new ChecksRequestError(
        400,
        'INVALID_BRANCH',
        'Invalid local branch name.',
      );
    try {
      await validateGitPolicyBranchName(branch);
    } catch (error) {
      if ((error as { code?: number }).code === 1)
        throw new ChecksRequestError(
          400,
          'INVALID_BRANCH',
          'Invalid local branch name.',
        );
      throw new ChecksRequestError(
        422,
        'GIT_STATE_UNAVAILABLE',
        'Unable to validate the local branch.',
      );
    }
    const policy = await resolveRepositoryGitPolicy(
      path,
      repositoryGitPolicy(path, this.policies),
    );
    if (policy.state === 'invalid')
      throw new ChecksRequestError(
        422,
        'INVALID_PUSH_POLICY',
        policy.error.message,
      );
    const rule =
      policy.state === 'configured'
        ? Object.hasOwn(policy.branches, branch)
          ? policy.branches[branch]
          : policy.default
        : null;
    if (rule?.directPush === 'forbidden')
      throw new ChecksRequestError(
        403,
        'DIRECT_PUSH_FORBIDDEN',
        'Direct push to this branch is forbidden.',
      );
    if (
      policy.state !== 'configured' ||
      policy.source !== 'repository-file' ||
      !rule?.requiredChecks?.length
    )
      throw new ChecksRequestError(
        422,
        'CHECK_RUNNER_UNAVAILABLE',
        'A repository declaration with required checks is needed.',
      );
    if (
      rule.requiredChecks.some((id) => !['lint-fix', 'test-run'].includes(id))
    )
      throw new ChecksRequestError(
        422,
        'CHECK_RUNNER_UNAVAILABLE',
        'A required check is not supported.',
      );
    if (this.closed || this.locks.size >= 2)
      throw new ChecksRequestError(
        503,
        'CHECKS_CAPACITY',
        'The check runner is at capacity.',
      );
    if (this.locks.has(path))
      throw new ChecksRequestError(
        409,
        'CHECKS_BUSY',
        'Checks are already active for this repository.',
      );
    const id = randomUUID();
    const value: ChecksOperation = {
      id,
      path,
      branch,
      commit: null,
      status: 'queued',
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      checks: rule.requiredChecks.map((checkId) => ({
        checkId,
        required: true,
        status: 'pending',
        commit: null,
        startedAt: null,
        completedAt: null,
      })),
      error: null,
      push: null,
    };
    let complete = () => {};
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const job: Job = { value, policy, done, resolve: complete };
    this.prune(1);
    this.jobs.set(id, job);
    this.locks.set(path, id);
    await this.persist();
    setImmediate(() => {
      void this.run(job);
    });
    return structuredClone(value);
  }
  get(id: string, path: string): ChecksOperation | null {
    this.prune();
    const job = this.jobs.get(id);
    return job?.value.path === path ? structuredClone(job.value) : null;
  }
  list(path: string): ChecksOperation[] {
    this.prune();
    return [...this.jobs.values()]
      .map((job) => job.value)
      .filter((value) => value.path === path)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .map((value) => structuredClone(value));
  }
  private finish(
    job: Job,
    status: ChecksOperation['status'],
    code?: NonNullable<ChecksOperation['error']>['code'],
  ) {
    if (terminal(job.value)) return;
    job.value.status = status;
    job.value.completedAt = now();
    if (code)
      job.value.error = {
        code,
        message:
          (
            {
              CHECK_FAILED: 'A required check failed.',
              CHECK_CONTEXT_MISMATCH:
                'The commit, working tree or policy no longer matches the checks.',
              CHECKS_TIMEOUT: 'Checks exceeded the allowed execution time.',
              CHECKS_CANCELLED: 'Checks were cancelled.',
              CHECK_RUNNER_UNAVAILABLE: 'A required script is unavailable.',
              INVALID_PUSH_POLICY: 'The repository declaration is invalid.',
            } as Record<string, string>
          )[code] ?? 'Unable to complete repository checks.',
      };
    for (const check of job.value.checks)
      if (['pending', 'running'].includes(check.status)) {
        check.status = status === 'timed_out' ? 'timed_out' : 'cancelled';
        check.completedAt = job.value.completedAt;
      }
    void this.persist();
  }
  private kill(job: Job) {
    if (!job.child?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-job.child.pid, 'SIGKILL');
      else job.child.kill('SIGKILL');
    } catch {
      /* Already exited. */
    }
  }
  cancel(id: string, path: string): ChecksOperation | null {
    const job = this.jobs.get(id);
    if (!job || job.value.path !== path) return null;
    if (!terminal(job.value)) {
      const queued = job.value.status === 'queued';
      this.finish(job, 'cancelled', 'CHECKS_CANCELLED');
      this.kill(job);
      if (queued) {
        this.locks.delete(path);
        job.resolve();
      }
    }
    return structuredClone(job.value);
  }
  async close() {
    this.closed = true;
    for (const job of this.jobs.values())
      this.cancel(job.value.id, job.value.path);
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    await Promise.allSettled([...this.pushes]);
    await this.history?.flush();
  }
  private reusable(
    job: Job,
    path: string,
    branch: string,
    policy: RepositoryGitPolicy,
  ): boolean {
    return (
      job.value.path === path &&
      job.value.branch === branch &&
      job.value.status === 'succeeded' &&
      !!job.value.completedAt &&
      Date.now() - Date.parse(job.value.completedAt) < 5 * 60_000 &&
      !job.used &&
      !!job.evidence &&
      JSON.stringify(policy) === JSON.stringify(job.policy)
    );
  }
  private latestJob(path: string, branch: string): Job | undefined {
    return [...this.jobs.values()]
      .filter((job) => job.value.path === path && job.value.branch === branch)
      .sort(
        (a, b) =>
          b.value.createdAt.localeCompare(a.value.createdAt) ||
          b.value.id.localeCompare(a.value.id),
      )[0];
  }
  async assessChecks(
    path: string,
    branch: string,
    policy?: RepositoryGitPolicy,
  ): Promise<{ checksId: string | null; reason: PushPolicyReason | null }> {
    this.prune();
    const current =
      policy ??
      (await resolveRepositoryGitPolicy(
        path,
        repositoryGitPolicy(path, this.policies),
      ));
    const rule =
      current.state === 'configured'
        ? Object.hasOwn(current.branches, branch)
          ? current.branches[branch]
          : current.default
        : null;
    const refused = (code: PushPolicyReason['code'], message: string) => ({
      checksId: null,
      reason: { code, message },
    });
    if (!rule?.requiredChecks?.length || rule.directPush === 'forbidden')
      return { checksId: null, reason: null };
    if (
      this.closed ||
      current.source !== 'repository-file' ||
      rule.requiredChecks.some((id) => !['lint-fix', 'test-run'].includes(id))
    )
      return refused(
        'CHECK_RUNNER_UNAVAILABLE',
        'The required checks are not supported by this server or policy source.',
      );
    if (this.locks.has(path))
      return refused(
        'CHECKS_RUNNING',
        'Checks or a checked push are active for this repository. Wait for completion.',
      );
    if (!(await managedChecksHook(path)))
      return refused(
        'CHECK_RUNNER_UNAVAILABLE',
        'The installed pre-push adapter does not support verified check reuse.',
      );
    const job = this.latestJob(path, branch);
    if (!job)
      return refused(
        'CHECKS_REQUIRED',
        'Run the required checks before pushing this branch.',
      );
    if (job.restored)
      return refused(
        'CHECKS_RESTARTED',
        'The API restarted after these checks. Run new checks.',
      );
    if (job.used)
      return refused(
        'CHECKS_CONSUMED',
        'This check result has already been used for a push attempt. Run new checks.',
      );
    if (job.value.status !== 'succeeded') {
      if (job.value.error?.code === 'CHECK_CONTEXT_MISMATCH')
        return refused(
          'CHECK_CONTEXT_MISMATCH',
          'The checks no longer match the commit, working tree or policy. Review changes and run new checks.',
        );
      if (job.value.error?.code === 'CHECK_RUNNER_UNAVAILABLE')
        return refused(
          'CHECK_RUNNER_UNAVAILABLE',
          'A required check script is unavailable.',
        );
      if (job.value.error?.code === 'INVALID_PUSH_POLICY')
        return refused(
          'INVALID_PUSH_POLICY',
          'The repository declaration could not be used for these checks.',
        );
      return job.value.status === 'failed'
        ? refused(
            'CHECK_FAILED',
            'The latest checks failed. Resolve the failure and run new checks.',
          )
        : refused(
            'CHECKS_REQUIRED',
            'The latest checks did not complete successfully. Run new checks.',
          );
    }
    if (
      !job.value.completedAt ||
      Date.now() - Date.parse(job.value.completedAt) >= 5 * 60_000
    )
      return refused(
        'CHECKS_EXPIRED',
        'The check result is older than five minutes. Run new checks.',
      );
    if (
      !this.reusable(job, path, branch, current) ||
      !job.evidence ||
      job.adapterDigest !== (await checksAdapterDigest()) ||
      !(await verifyChecksContext(path, branch, job.evidence))
    )
      return refused(
        'CHECK_CONTEXT_MISMATCH',
        'The checks no longer match the commit, working tree or policy. Review changes and run new checks.',
      );
    return { checksId: job.value.id, reason: null };
  }
  async pushWithChecks(
    id: string,
    path: string,
    branch: string,
  ): Promise<GitPushResult> {
    const promise = this.checkedPush(id, path, branch);
    this.pushes.add(promise);
    try {
      return await promise;
    } finally {
      this.pushes.delete(promise);
    }
  }
  private async checkedPush(
    id: string,
    path: string,
    branch: string,
  ): Promise<GitPushResult> {
    this.prune();
    const job = this.jobs.get(id);
    if (!job || job.value.path !== path || job.value.branch !== branch)
      throw new ChecksRequestError(
        404,
        'CHECKS_NOT_FOUND',
        'Check operation not found for this repository and branch.',
      );
    if (job.restored)
      throw new ChecksRequestError(
        409,
        'CHECK_CONTEXT_MISMATCH',
        'This check result belongs to a previous API instance. Run new checks.',
      );
    if (job.used)
      throw new ChecksRequestError(
        409,
        'CHECK_CONTEXT_MISMATCH',
        'This check result has already been consumed by a push attempt.',
      );
    if (this.closed || this.locks.has(path))
      throw new ChecksRequestError(
        409,
        'CHECKS_BUSY',
        'Checks or a checked push are already active.',
      );
    this.locks.set(path, id);
    let proof: Awaited<ReturnType<typeof createChecksProof>> | undefined;
    const startedAt = now();
    try {
      const current = await resolveRepositoryGitPolicy(
        path,
        repositoryGitPolicy(path, this.policies),
      );
      if (
        this.latestJob(path, branch) !== job ||
        !this.reusable(job, path, branch, current) ||
        !job.evidence ||
        job.adapterDigest !== (await checksAdapterDigest()) ||
        !(await managedChecksHook(path)) ||
        !(await verifyChecksContext(path, branch, job.evidence))
      )
        throw new ChecksRequestError(
          409,
          'CHECK_CONTEXT_MISMATCH',
          'Checks are missing, expired, consumed or no longer match this push.',
        );
      job.used = true;
      proof = await createChecksProof(
        path,
        branch,
        job.evidence,
        this.keys.privateKey,
        this.keys.publicKey,
      );
      job.value.push = {
        status: 'running',
        startedAt,
        completedAt: null,
        error: null,
      };
      await this.persist();
      const result = await pushRepositoryBranch(
        path,
        branch,
        repositoryGitPolicy(path, this.policies),
        proof,
      );
      job.value.push = {
        status: result.success ? 'succeeded' : 'failed',
        startedAt,
        completedAt: now(),
        error: result.success
          ? null
          : { code: result.code, message: result.error },
      };
      return result;
    } catch (error) {
      if (job.value.status === 'succeeded')
        job.value.push = {
          status: 'failed',
          startedAt,
          completedAt: now(),
          error: {
            code:
              error instanceof ChecksRequestError ? error.code : 'PUSH_FAILED',
            message:
              error instanceof ChecksRequestError
                ? error.message
                : 'Unable to complete the checked push.',
          },
        };
      if (error instanceof ChecksRequestError) throw error;
      throw new ChecksRequestError(
        502,
        'PUSH_FAILED',
        'Unable to complete the checked push.',
      );
    } finally {
      await this.persist();
      if (proof) await proof.dispose();
      if (this.locks.get(path) === id) this.locks.delete(path);
    }
  }
  private async run(job: Job) {
    if (job.value.status !== 'queued') return;
    const value = job.value;
    value.status = 'running';
    value.startedAt = now();
    void this.persist();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const current = await resolveRepositoryGitPolicy(
        value.path,
        repositoryGitPolicy(value.path, this.policies),
      );
      if (terminal(value)) return;
      if (JSON.stringify(current) !== JSON.stringify(job.policy)) {
        this.finish(job, 'failed', 'CHECK_CONTEXT_MISMATCH');
        return;
      }
      let commit: string;
      try {
        commit = (
          await execute(
            'git',
            ['rev-parse', '--verify', `refs/heads/${value.branch}`],
            {
              cwd: value.path,
              timeout: 5000,
              maxBuffer: 4096,
              env: {
                ...createCommandEnvironment('git'),
                GIT_NO_LAZY_FETCH: '1',
              },
            },
          )
        ).stdout.trim();
      } catch {
        this.finish(job, 'failed', 'GIT_STATE_UNAVAILABLE');
        return;
      }
      if (terminal(value)) return;
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) {
        this.finish(job, 'failed', 'GIT_STATE_UNAVAILABLE');
        return;
      }
      value.commit = commit;
      for (const check of value.checks) check.commit = commit;
      job.adapterDigest = await checksAdapterDigest();
      const child = spawn(
        process.execPath,
        [checksAdapterPath, '--report-checks', 'origin'],
        {
          cwd: value.path,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
          env: { ...createCommandEnvironment('git'), GIT_NO_LAZY_FETCH: '1' },
        },
      );
      job.child = child;
      let buffer = '';
      let report: 'succeeded' | 'failed' | undefined;
      let failure: PushPolicyCode = 'CHECK_FAILED';
      let invalid = false;
      let evidence: ChecksEvidence | undefined;
      const protocolFailure = () => {
        invalid = true;
        this.kill(job);
      };
      child.stdio[3]?.on('data', (chunk: Buffer) => {
        if (terminal(value)) return;
        buffer += chunk.toString('utf8');
        if (buffer.length > 8192) {
          protocolFailure();
          return;
        }
        while (buffer.includes('\n')) {
          const newline = buffer.indexOf('\n');
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (report) throw new Error('Unexpected event.');
            if (event.checkId !== undefined) {
              if (
                !['lint-fix', 'test-run'].includes(event.checkId) ||
                !['running', 'passed', 'failed'].includes(event.status) ||
                typeof event.required !== 'boolean'
              )
                throw new Error('Invalid check event.');
              let check = value.checks.find(
                (item) => item.checkId === event.checkId,
              );
              if (!check) {
                check = {
                  checkId: event.checkId,
                  required: event.required,
                  status: 'pending',
                  commit,
                  startedAt: null,
                  completedAt: null,
                };
                value.checks.push(check);
              }
              if (
                (event.status === 'running' && check.status !== 'pending') ||
                (event.status !== 'running' && check.status !== 'running')
              )
                throw new Error('Invalid check transition.');
              check.required ||= event.required;
              check.status = event.status;
              if (event.status === 'running') check.startedAt = now();
              else check.completedAt = now();
              void this.persist();
            } else {
              if (!['succeeded', 'failed'].includes(event.status))
                throw new Error('Invalid completion.');
              report = event.status;
              if (event.status === 'succeeded') {
                if (
                  !event.evidence ||
                  event.evidence.commit !== commit ||
                  event.evidence.ref !== `refs/heads/${value.branch}` ||
                  !/^[a-f0-9]{64}$/.test(event.evidence.policyDigest)
                )
                  throw new Error('Invalid check evidence.');
                evidence = event.evidence;
              }
              if (event.status === 'failed') {
                if (
                  ![
                    'CHECK_FAILED',
                    'CHECK_CONTEXT_MISMATCH',
                    'CHECK_RUNNER_UNAVAILABLE',
                    'INVALID_PUSH_POLICY',
                  ].includes(event.code)
                )
                  throw new Error('Invalid error code.');
                failure = event.code;
              }
            }
          } catch {
            protocolFailure();
          }
        }
      });
      timer = setTimeout(
        () => {
          this.finish(job, 'timed_out', 'CHECKS_TIMEOUT');
          this.kill(job);
        },
        this.options.timeoutMs ?? 10 * 60_000,
      );
      const exit = await new Promise<number | null>((resolve) => {
        child.on('error', () => {
          invalid = true;
        });
        child.on('close', (code) => resolve(code));
        child.stdin?.on('error', () => {});
        child.stdin?.end(
          `refs/heads/${value.branch} ${commit} refs/heads/${value.branch} ${'0'.repeat(commit.length)}\n`,
        );
      });
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      job.child = undefined;
      if (terminal(value)) return;
      if (invalid || buffer || exit !== 0 || report !== 'succeeded') {
        this.finish(job, 'failed', invalid ? 'CHECKS_FAILED' : failure);
        return;
      }
      const after = await resolveRepositoryGitPolicy(
        value.path,
        repositoryGitPolicy(value.path, this.policies),
      );
      if (JSON.stringify(after) !== JSON.stringify(job.policy)) {
        this.finish(job, 'failed', 'CHECK_CONTEXT_MISMATCH');
        return;
      }
      if (
        value.checks.some(
          (check) => check.required && check.status !== 'passed',
        )
      ) {
        this.finish(job, 'failed', 'CHECK_FAILED');
        return;
      }
      if (!evidence) {
        this.finish(job, 'failed', 'CHECKS_FAILED');
        return;
      }
      job.evidence = evidence;
      this.finish(job, 'succeeded');
    } catch {
      this.finish(job, 'failed', 'CHECKS_FAILED');
      this.kill(job);
    } finally {
      if (timer) clearTimeout(timer);
      if (this.locks.get(value.path) === value.id)
        this.locks.delete(value.path);
      job.resolve();
    }
  }
}
