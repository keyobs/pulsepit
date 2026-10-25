import {
  getOutdatedDependencies,
  type OutdatedResult,
} from './outdated.service.js';

// Each API instance owns its deadlines; only sanitized results are retained.
export function createDependencyDiagnostics() {
  const deadlines = new Map<
    string,
    { expiresAt: number; result: OutdatedResult }
  >();
  const running = new Map<string, Promise<OutdatedResult>>();

  return async (repositoryPath: string): Promise<OutdatedResult> => {
    const now = Date.now();
    for (const [path, entry] of deadlines) {
      if (entry.expiresAt <= now) deadlines.delete(path);
    }
    const blocked = deadlines.get(repositoryPath);
    if (blocked) return blocked.result;
    const active = running.get(repositoryPath);
    if (active) return active;

    const operation = getOutdatedDependencies(repositoryPath)
      .then((result) => {
        if (
          result.error !== null &&
          result.code === 'REGISTRY_RATE_LIMITED' &&
          result.resetAt !== undefined
        ) {
          const expiresAt = Date.parse(result.resetAt);
          if (expiresAt > Date.now())
            deadlines.set(repositoryPath, { expiresAt, result });
        }
        return result;
      })
      .finally(() => running.delete(repositoryPath));
    running.set(repositoryPath, operation);
    return operation;
  };
}
