import { makeRepository } from '@test/fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BeaconTab } from './BeaconTab';

const state = vi.hoisted(() => ({
  outdated: {
    state: { status: 'idle', data: null, error: null },
    run: vi.fn(),
  },
}));

vi.mock('../../hooks/useRepositoryRuntime', () => ({
  useRepositoryRuntime: () => state,
}));
vi.mock('@hooks/useBeaconVersion', () => ({
  useBeaconVersion: (_: string, enabled: boolean) => ({
    version: enabled ? '^1.2.0' : null,
    isLoading: false,
  }),
}));

const withBeacon = (installed: boolean) =>
  makeRepository({
    beacon: { package: installed, configuration: 'ok', active: installed },
  });

describe('BeaconTab', () => {
  it('shows Non détecté without the package', () => {
    render(<BeaconTab repository={withBeacon(false)} />);
    expect(screen.getByText('Non détecté')).toBeInTheDocument();
  });

  it('shows Installé with the declared version before any diagnostic', () => {
    render(<BeaconTab repository={withBeacon(true)} />);
    expect(screen.getByText('Installé')).toBeInTheDocument();
    expect(screen.getByText('^1.2.0')).toBeInTheDocument();
  });
});
