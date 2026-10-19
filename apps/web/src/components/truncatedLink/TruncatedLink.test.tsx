import { fireEvent, render, screen } from '@testing-library/react';
import { TruncatedLink } from './TruncatedLink';

describe('TruncatedLink', () => {
  it('shows the url as label and opens in a new tab', () => {
    render(<TruncatedLink href="https://app.domaine.fr" />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('https://app.domaine.fr');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('can show a custom label', () => {
    render(
      <TruncatedLink href="https://app.domaine.fr" label="app.domaine.fr" />,
    );
    expect(screen.getByRole('link')).toHaveTextContent('app.domaine.fr');
  });

  it('blocks a plain click and notifies', () => {
    const onBlockedClick = vi.fn();
    render(
      <TruncatedLink
        href="https://app.domaine.fr"
        onBlockedClick={onBlockedClick}
      />,
    );
    const notPrevented = fireEvent.click(screen.getByRole('link'));
    expect(notPrevented).toBe(false);
    expect(onBlockedClick).toHaveBeenCalledTimes(1);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'follows the link with %o',
    (modifier) => {
      const onBlockedClick = vi.fn();
      render(
        <TruncatedLink
          href="https://app.domaine.fr"
          onBlockedClick={onBlockedClick}
        />,
      );
      const notPrevented = fireEvent.click(screen.getByRole('link'), modifier);
      expect(notPrevented).toBe(true);
      expect(onBlockedClick).not.toHaveBeenCalled();
    },
  );
});
