import { render } from '@testing-library/react';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders a decorative icon', () => {
    const { container } = render(<Spinner />);
    const icon = container.querySelector('.pp-spinner');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
