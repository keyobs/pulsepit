import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AppConfig {
  port: number;
  scanPaths: string[];
  configPath?: string;
  githubToken?: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.CONFIG_PATH !== undefined && !env.CONFIG_PATH.trim()) {
    throw new Error('CONFIG_PATH must contain a non-empty file path.');
  }
  const rawPaths = env.SCAN_PATH;
  if (!rawPaths?.trim()) {
    throw new Error(
      'Configure SCAN_PATH with a directory path or a JSON array of directory paths.',
    );
  }

  let paths: unknown = rawPaths;
  if (rawPaths.trimStart().startsWith('[')) {
    try {
      paths = JSON.parse(rawPaths);
    } catch {
      throw new Error(
        'SCAN_PATH must contain a valid JSON array of directory paths.',
      );
    }
  }

  const directories = Array.isArray(paths) ? paths : [paths];
  if (
    directories.length === 0 ||
    !directories.every(
      (path): path is string =>
        typeof path === 'string' && path.trim().length > 0,
    )
  ) {
    throw new Error(
      'SCAN_PATH must contain a non-empty directory path or a non-empty JSON array of directory paths.',
    );
  }

  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return {
    port,
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    scanPaths: [...new Set(directories.map((path) => resolve(path)))],
    configPath: resolve(
      env.CONFIG_PATH ??
        join(
          env.XDG_CONFIG_HOME || join(homedir(), '.config'),
          'pulsepit',
          'config.json',
        ),
    ),
  };
}
