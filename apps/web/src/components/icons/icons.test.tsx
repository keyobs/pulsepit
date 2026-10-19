import { render } from '@testing-library/react';
import { FetchIcon } from './FetchIcon';
import { PushIcon } from './PushIcon';

describe('icons', () => {
  it('FetchIcon is a decorative icon with the fetch color class', () => {
    const { container } = render(<FetchIcon />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('pp-icon', 'fetch');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('PushIcon is a decorative icon with the push color class', () => {
    const { container } = render(<PushIcon className="extra" />);
    expect(container.querySelector('svg')).toHaveClass(
      'pp-icon',
      'push',
      'extra',
    );
  });
});
