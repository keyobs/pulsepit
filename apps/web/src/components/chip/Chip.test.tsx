import { render, screen } from '@testing-library/react';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders its content with the neutral variant by default', () => {
    render(<Chip>main 2.3.1</Chip>);
    expect(screen.getByText('main 2.3.1')).toHaveClass('pp-chip', 'neutral');
  });

  it('applies the requested variant and title', () => {
    render(
      <Chip variant="warn" title="2 fichiers">
        2 modifiés
      </Chip>,
    );
    const chip = screen.getByText('2 modifiés');
    expect(chip).toHaveClass('warn');
    expect(chip).toHaveAttribute('title', '2 fichiers');
  });

  it('renders the icon before the content', () => {
    render(<Chip icon={<svg data-testid="icon" />}>Online</Chip>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
