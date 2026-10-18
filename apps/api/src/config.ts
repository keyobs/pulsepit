import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  scanPaths: string[];
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
    scanPaths: [...new Set(directories.map((path) => resolve(path)))],
  };
}
