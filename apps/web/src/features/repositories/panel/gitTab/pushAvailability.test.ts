import type { LocalBranch } from '@api/types';
import { describe, expect, it } from 'vitest';
import { getPushAvailability } from './pushAvailability';

const branch = (
  pushAssessment: LocalBranch['pushAssessment'],
): LocalBranch => ({
  name: 'main',
  isCurrent: false,
  policy: { directPush: 'unknown', requiredChecks: null },
  pushAssessment,
});

describe('getPushAvailability', () => {
  it('lets the back decide when the branch is unknown', () => {
    expect(getPushAvailability(undefined)).toEqual({
      canAttempt: true,
      reason: null,
    });
  });

  it('blocks with a French reason from the code', () => {
    const result = getPushAvailability(
      branch({
        state: 'blocked',
        canAttempt: false,
        reasons: [{ code: 'DIRECT_PUSH_FORBIDDEN', message: 'x' }],
      }),
    );
    expect(result).toEqual({
      canAttempt: false,
      reason: 'Push direct interdit',
    });
  });

  it('keeps the push available when policy is unconfigured', () => {
    const result = getPushAvailability(
      branch({
        state: 'unknown',
        canAttempt: true,
        reasons: [{ code: 'POLICY_UNCONFIGURED', message: 'x' }],
      }),
    );
    expect(result.canAttempt).toBe(true);
  });
});
