import type { BeaconMonitoringEnvironment } from '@api/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BeaconMonitoringStatus } from './BeaconMonitoringStatus';

const make = (
  overrides: Partial<BeaconMonitoringEnvironment>,
): BeaconMonitoringEnvironment => ({
  path: '/repo',
  environment: 'production',
  enabled: true,
  interval: '5m',
  status: 'up',
  since: '2026-10-25T10:00:00.000Z',
  lastCheckedAt: '2026-10-25T10:05:00.000Z',
  error: null,
  ...overrides,
});

describe('BeaconMonitoringStatus', () => {
  it('shows a readable beacon with its frequency', () => {
    render(<BeaconMonitoringStatus monitoring={make({})} />);
    expect(screen.getByText('Balise lisible')).toBeInTheDocument();
    expect(screen.getByText(/toutes les 5 min/)).toBeInTheDocument();
  });

  it('shows an unreadable beacon with the translated cause', () => {
    render(
      <BeaconMonitoringStatus
        monitoring={make({
          status: 'down',
          error: { code: 'TIMEOUT', message: 'raw' },
        })}
      />,
    );
    expect(screen.getByText(/Balise illisible depuis/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Le fichier de métadonnées met trop de temps à répondre.',
    );
  });

  it('shows a waiting state before the first check', () => {
    render(
      <BeaconMonitoringStatus
        monitoring={make({
          status: 'pending',
          lastCheckedAt: null,
        })}
      />,
    );
    expect(
      screen.getByText('En attente du premier contrôle'),
    ).toBeInTheDocument();
  });
});
