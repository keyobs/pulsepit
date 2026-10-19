import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  afterEach(() => vi.restoreAllMocks());

  it('copies the value then notifies', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const onCopied = vi.fn();
    render(<CopyButton value="https://app.domaine.fr" onCopied={onCopied} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Copier le lien' }),
    );
    expect(writeText).toHaveBeenCalledWith('https://app.domaine.fr');
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it('notifies an error when the copy fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false);
    const onError = vi.fn();
    render(<CopyButton value="x" onError={onError} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Copier le lien' }),
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
