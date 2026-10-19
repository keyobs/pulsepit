import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from './Popover';

const setup = (
  children: React.ComponentProps<typeof Popover>['children'] = 'contenu',
) =>
  render(
    <div>
      <Popover
        renderTrigger={({ isOpen, toggle }) => (
          <button type="button" aria-expanded={isOpen} onClick={toggle}>
            ouvrir
          </button>
        )}
      >
        {children}
      </Popover>
      <span>dehors</span>
    </div>,
  );

describe('Popover', () => {
  it('is closed until the trigger is clicked', async () => {
    setup();
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ouvrir' }));
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ouvrir' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes on an outside click', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'ouvrir' }));
    await userEvent.click(screen.getByText('dehors'));
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'ouvrir' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
  });

  it('gives children a close function', async () => {
    setup((close) => (
      <button type="button" onClick={close}>
        fermer
      </button>
    ));
    await userEvent.click(screen.getByRole('button', { name: 'ouvrir' }));
    await userEvent.click(screen.getByRole('button', { name: 'fermer' }));
    expect(
      screen.queryByRole('button', { name: 'fermer' }),
    ).not.toBeInTheDocument();
  });
});
