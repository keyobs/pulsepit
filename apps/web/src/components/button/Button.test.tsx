import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label and calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Fetch All</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Fetch All' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a non-submitting button by default', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="primary" size="small">
        Go
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass(
      'pp-button',
      'primary',
      'small',
    );
  });

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled and busy while loading', () => {
    render(<Button loading>Diagnostic</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('loading');
  });

  it('renders the icon next to the label', () => {
    render(<Button icon={<svg data-testid="icon" />}>Push</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
