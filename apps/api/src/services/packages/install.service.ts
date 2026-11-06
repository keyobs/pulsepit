import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import type {
  InstallResponse,
  RegistryDiagnosticCode,
} from '@pulsepit/contracts';
import { createCommandEnvironment } from '../processes/command-environment.service.js';
import {
  detectPackageManager,
  type PackageManager,
} from './package-manager.service.js';
import { registryDiagnostic } from './registry-diagnostic.service.js';

export const INSTALL_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_LIMIT = 256 * 1024;

export type InstallFailure = {
  code:
    | 'PACKAGE_MANAGER'
    | 'INSTALL_RUNNING'
    | 'INSTALL_FAILED'
    | 'TIMEOUT'
    | RegistryDiagnosticCode;
  error: string;
};
export type InstallResult = Omit<InstallResponse, 'path'> | InstallFailure;

// pnpm aborts without a TTY when it must purge node_modules.
const installArgs: Record<PackageManager, string[]> = {
  npm: ['install', '--no-audit', '--no-fund'],
  pnpm: ['install', '--config.confirmModulesPurge=false'],
  yarn: ['install'],
};

type RunOutcome = {
  exitCode: number | null;
  timedOut: boolean;
  missing: boolean;
  stdout: string;
  stderr: string;
};

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const keepTail = (current: string, chunk: Buffer) =>
      (current + chunk.toString('utf8')).slice(-OUTPUT_LIMIT);
    const child = spawn(command, args, {
      cwd,
      env: createCommandEnvironment('package-manager'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32')
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Already exited. */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = keepTail(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = keepTail(stderr, chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut: false,
        missing: error.code === 'ENOENT',
        stdout,
        stderr,
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut, missing: false, stdout, stderr });
    });
  });
}

function failureDetail(stdout: string, stderr: string): string | null {
  const lines = stripVTControlCharacters(`${stderr}\n${stdout}`)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/complete log of this run/i.test(line));
  const line =
    lines.find((entry) => /\b(?:ERR!?|error)\b/i.test(entry)) ?? lines.at(-1);
  return line ? line.slice(0, 300) : null;
}

export async function installDependencies(
  repositoryPath: string,
  timeoutMs = INSTALL_TIMEOUT_MS,
): Promise<InstallResult> {
  const manager = await detectPackageManager(repositoryPath);
  if (manager.error || manager.name === null) {
    return {
      code: 'PACKAGE_MANAGER',
      error:
        manager.error ?? 'No package manager detected for this repository.',
    };
  }
  const name = manager.name;
  const args = installArgs[name];
  const startedAt = Date.now();
  const outcome = await run(name, args, repositoryPath, timeoutMs);
  if (outcome.missing)
    return {
      code: 'INSTALL_FAILED',
      error: `${name} executable was not found in PATH.`,
    };
  if (outcome.timedOut)
    return {
      code: 'TIMEOUT',
      error: `${name} install timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
    };
  if (outcome.exitCode !== 0) {
    const registry = registryDiagnostic(
      name,
      outcome.stdout,
      outcome.stderr,
      true,
    );
    if (registry) return { code: registry.code, error: registry.error };
    const detail = failureDetail(outcome.stdout, outcome.stderr);
    return {
      code: 'INSTALL_FAILED',
      error: `${name} install failed${detail ? `: ${detail}` : '.'}`,
    };
  }
  return {
    packageManager: name,
    command: `${name} ${args.join(' ')}`,
    durationMs: Date.now() - startedAt,
    success: true,
  };
}

// One install per repository at a time.
export function createDependencyInstaller(
  install: (path: string) => Promise<InstallResult> = installDependencies,
) {
  const running = new Set<string>();
  return async (repositoryPath: string): Promise<InstallResult> => {
    if (running.has(repositoryPath))
      return {
        code: 'INSTALL_RUNNING',
        error: 'An install is already running for this repository.',
      };
    running.add(repositoryPath);
    try {
      return await install(repositoryPath);
    } finally {
      running.delete(repositoryPath);
    }
  };
}
