import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu } from './DropdownMenu';

const items = [
  { id: 'feat/billing', label: 'feat/billing', hint: '→ origin' },
  { id: 'fix/login', label: 'fix/login' },
];

describe('DropdownMenu', () => {
  it('opens a menu with a header and its items', async () => {
    render(
      <DropdownMenu
        label="Push - Choisir une branche"
        header="Branche à pousser"
        items={items}
        onSelect={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Push - Choisir une branche/ }),
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Branche à pousser')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('selects an item then closes the menu', async () => {
    const onSelect = vi.fn();
    render(<DropdownMenu label="Push" items={items} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Push/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /fix\/login/ }));
    expect(onSelect).toHaveBeenCalledWith('fix/login');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows the empty text when there are no items', async () => {
    render(
      <DropdownMenu
        label="Push"
        items={[]}
        emptyText="Aucune autre branche locale"
        onSelect={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Push/ }));
    expect(screen.getByText('Aucune autre branche locale')).toBeInTheDocument();
  });

  it('does not open when disabled', async () => {
    render(
      <DropdownMenu label="Push" items={items} disabled onSelect={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Push/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
