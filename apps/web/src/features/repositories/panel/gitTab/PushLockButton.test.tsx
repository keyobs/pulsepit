import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PushLockButton } from './PushLockButton';

describe('PushLockButton', () => {
  it('toggles a branch lock', async () => {
    const onToggle = vi.fn();
    render(
      <PushLockButton
        branch="main"
        scope="none"
        loading={false}
        onToggle={onToggle}
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Verrouiller le push de main',
    });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows a locked branch and its unlock action', () => {
    render(
      <PushLockButton
        branch="develop"
        scope="branch"
        loading={false}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Déverrouiller le push de develop' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('is disabled when a wider setting locks the branch', () => {
    render(
      <PushLockButton
        branch="main"
        scope="other"
        loading={false}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /réglage plus large/ }),
    ).toBeDisabled();
  });
});
