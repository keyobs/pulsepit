import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

const items = [
  { id: 'git', label: 'Git' },
  { id: 'deps', label: 'Dépendances' },
  { id: 'errors', label: 'Erreurs', badge: 'v2' },
] as const;

describe('Tabs', () => {
  it('marks the active tab as selected', () => {
    render(
      <Tabs
        items={[...items]}
        activeId="deps"
        onChange={() => {}}
        ariaLabel="Détails"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Dépendances' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Git' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onChange with the clicked tab id', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        items={[...items]}
        activeId="git"
        onChange={onChange}
        ariaLabel="Détails"
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Dépendances' }));
    expect(onChange).toHaveBeenCalledWith('deps');
  });

  it('shows the badge of a tab', () => {
    render(
      <Tabs
        items={[...items]}
        activeId="git"
        onChange={() => {}}
        ariaLabel="Détails"
      />,
    );
    expect(screen.getByText('v2')).toBeInTheDocument();
  });
});
