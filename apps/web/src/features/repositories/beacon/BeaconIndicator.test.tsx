import { render, screen } from '@testing-library/react';
import { BeaconIndicator } from './BeaconIndicator';

describe('BeaconIndicator', () => {
  it('is marked active when the beacon is active', () => {
    render(
      <BeaconIndicator
        beacon={{ package: true, configuration: 'ok', active: true }}
      />,
    );
    const icon = screen.getByRole('img', { name: /Beacon actif/ });
    expect(icon).toHaveClass('active');
  });

  it('is neutral when declared but not active', () => {
    render(
      <BeaconIndicator
        beacon={{ package: true, configuration: 'missing', active: false }}
      />,
    );
    const icon = screen.getByRole('img', { name: /source non configurée/ });
    expect(icon).not.toHaveClass('active');
  });

  it('reports an invalid configuration', () => {
    render(
      <BeaconIndicator
        beacon={{ package: true, configuration: 'invalid', active: false }}
      />,
    );
    expect(
      screen.getByRole('img', { name: /configuration invalide/ }),
    ).toBeTruthy();
  });

  it('renders nothing without a beacon unless asked to', () => {
    const absent = {
      package: false,
      configuration: 'missing',
      active: false,
    } as const;
    const { container, rerender } = render(<BeaconIndicator beacon={absent} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BeaconIndicator beacon={absent} showWhenAbsent />);
    expect(screen.getByRole('img', { name: 'Beacon non détecté' })).toHaveClass(
      'absent',
    );
  });
});
