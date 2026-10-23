import type { ChecksOperation } from '@api/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChecksStatus } from './ChecksStatus';

const SHA = 'a'.repeat(40);

const operation = (
  overrides: Partial<ChecksOperation> = {},
): ChecksOperation => ({
  id: '3f1b1f0e-6d0e-4a52-9d57-0f7b8d8f4c11',
  path: '/repo',
  branch: 'develop',
  commit: SHA,
  status: 'succeeded',
  createdAt: '2026-10-23T10:00:00.000Z',
  startedAt: '2026-10-23T10:00:01.000Z',
  completedAt: '2026-10-23T10:00:30.000Z',
  checks: [
    {
      checkId: 'test-run',
      required: true,
      status: 'passed',
      commit: SHA,
      startedAt: '2026-10-23T10:00:01.000Z',
      completedAt: '2026-10-23T10:00:30.000Z',
    },
  ],
  push: null,
  error: null,
  ...overrides,
});

describe('ChecksStatus', () => {
  it('does not present passed checks as a push', () => {
    render(<ChecksStatus operation={operation()} />);
    expect(screen.getByText('Contrôles réussis')).toBeInTheDocument();
    expect(screen.queryByText(/Push/)).not.toBeInTheDocument();
  });

  it('shows the push result separately', () => {
    render(
      <ChecksStatus
        operation={operation({
          push: {
            status: 'failed',
            startedAt: '2026-10-23T10:00:31.000Z',
            completedAt: '2026-10-23T10:00:32.000Z',
            error: { code: 'PUSH_INTERRUPTED', message: 'x' },
          },
        })}
      />,
    );
    expect(screen.getByText('Push en échec')).toBeInTheDocument();
    expect(screen.getByText(/Suivi du push interrompu/)).toBeInTheDocument();
  });
});
