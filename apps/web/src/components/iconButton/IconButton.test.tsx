import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('is named by its label and icon-only', async () => {
    const onClick = vi.fn();
    render(
      <IconButton icon={<svg />} label="Copier le lien" onClick={onClick} />,
    );
    const button = screen.getByRole('button', { name: 'Copier le lien' });
    expect(button).toHaveClass('icon-only');
    expect(button).toHaveAttribute('title', 'Copier le lien');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
