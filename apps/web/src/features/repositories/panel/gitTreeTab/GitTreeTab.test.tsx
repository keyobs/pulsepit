import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GitTreeTab } from './GitTreeTab';

const state = vi.hoisted(() => ({
  query: { status: 'pending', data: undefined, error: null } as Record<
    string,
    unknown
  >,
}));

vi.mock('@hooks/useGitTree', () => ({ useGitTree: () => state.query }));

describe('GitTreeTab', () => {
  it('shows a loader while reading', () => {
    render(<GitTreeTab path="/repo" />);
    expect(screen.getByText(/Lecture de l'historique/)).toBeInTheDocument();
  });

  it('lists commits and branches', () => {
    state.query = {
      status: 'success',
      error: null,
      data: {
        path: '/repo',
        mainRef: 'origin/main',
        commits: [
          {
            hash: 'a'.repeat(40),
            shortHash: 'aaaaaaa',
            subject: 'feat: hello',
            author: 'Ada',
            date: '2025-01-01T10:00:00.000Z',
          },
        ],
        branches: [
          {
            name: 'feature/x',
            author: 'Bob',
            createdAt: '2025-02-01T10:00:00.000Z',
            merged: false,
          },
          {
            name: 'fix/y',
            author: 'Cy',
            createdAt: '2025-01-15T10:00:00.000Z',
            merged: true,
          },
        ],
      },
    };
    render(<GitTreeTab path="/repo" />);
    expect(
      screen.getByText('10 derniers commits · origin/main'),
    ).toBeInTheDocument();
    expect(screen.getByText('aaaaaaa')).toBeInTheDocument();
    expect(screen.getByText('feat: hello')).toBeInTheDocument();
    expect(screen.getByText('feature/x')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getAllByText('merged')).toHaveLength(1);
  });
});
