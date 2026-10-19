import { render, screen } from '@testing-library/react';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('exposes its label to assistive technology', () => {
    render(<StatusDot status="ok" label="En ligne" />);
    expect(screen.getByRole('img', { name: 'En ligne' })).toHaveClass(
      'pp-status-dot',
      'ok',
    );
  });

  it('is decorative without a label', () => {
    const { container } = render(<StatusDot status="bad" />);
    const dot = container.querySelector('.pp-status-dot');
    expect(dot).toHaveClass('bad');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
