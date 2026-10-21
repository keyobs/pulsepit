import type { DeploymentCommitComparison } from '@api/types';

const UNKNOWN_REASONS: Record<
  Extract<DeploymentCommitComparison, { status: 'unknown' }>['reason'],
  string
> = {
  BRANCH_NOT_CONFIGURED: 'Branche non configurée',
  INVALID_BRANCH: 'Nom de branche invalide',
  COMMIT_UNAVAILABLE: 'Commit déployé inconnu',
  BRANCH_NOT_FOUND: 'Branche absente en local',
  COMMIT_NOT_FOUND: 'Commit déployé absent du dépôt local',
  SHALLOW_HISTORY: 'Historique local incomplet (clone shallow)',
  UNRELATED_HISTORY: 'Historiques sans ancêtre commun',
  TIMEOUT: 'Comparaison trop longue',
  GIT_ERROR: 'Comparaison impossible (erreur Git)',
};

const commits = (count: number) => `${count} commit${count > 1 ? 's' : ''}`;

export function describeComparison(
  comparison: DeploymentCommitComparison,
): string {
  if (comparison.status === 'unknown') {
    return UNKNOWN_REASONS[comparison.reason];
  }
  const branch = comparison.reference.replace(/^refs\/heads\//, '');
  switch (comparison.status) {
    case 'up_to_date':
      return `À jour avec ${branch}`;
    case 'behind':
      return `${commits(comparison.behind)} de retard sur ${branch}`;
    case 'ahead':
      return `${commits(comparison.ahead)} d'avance sur ${branch}`;
    case 'diverged':
      return `Historique divergent de ${branch} (${commits(comparison.ahead)} d'avance, ${commits(comparison.behind)} de retard)`;
  }
}
