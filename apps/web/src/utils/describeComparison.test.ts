import type { DeploymentCommitComparison } from '@api/types';
import { describeComparison } from './describeComparison';

const known = (
  status: 'up_to_date' | 'behind' | 'ahead' | 'diverged',
  ahead: number,
  behind: number,
): DeploymentCommitComparison => ({
  reference: 'refs/heads/main',
  referenceCommit: 'a'.repeat(40),
  status,
  ahead,
  behind,
  reason: null,
});

describe('describeComparison', () => {
  it('describes each known status from the deployment point of view', () => {
    expect(describeComparison(known('up_to_date', 0, 0))).toBe(
      'À jour avec main',
    );
    expect(describeComparison(known('behind', 0, 3))).toBe(
      '3 commits de retard sur main',
    );
    expect(describeComparison(known('ahead', 1, 0))).toBe(
      "1 commit d'avance sur main",
    );
    expect(describeComparison(known('diverged', 2, 1))).toContain('divergent');
  });

  it('explains an unknown comparison by its reason', () => {
    expect(
      describeComparison({
        reference: null,
        referenceCommit: null,
        status: 'unknown',
        ahead: null,
        behind: null,
        reason: 'BRANCH_NOT_CONFIGURED',
      }),
    ).toBe('Branche non configurée');
  });
});
