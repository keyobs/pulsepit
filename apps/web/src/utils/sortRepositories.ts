import type { Repository } from '@api/types';


export function lastActivityTime(repository: Repository): number {
  const time = repository.developLastCommitAt
    ? Date.parse(repository.developLastCommitAt)
    : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function sortByRecentActivity(repositories: Repository[]): Repository[] {
  return [...repositories].sort(
    (a, b) =>
      lastActivityTime(b) - lastActivityTime(a) || a.name.localeCompare(b.name),
  );
}
