import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { value: 'compact', label: 'Vue compacte' },
  { value: 'detailed', label: 'Vue détaillée' },
] as const;

describe('SegmentedControl', () => {
  it('flags the selected option as pressed', () => {
    render(
      <SegmentedControl
        options={[...options]}
        value="detailed"
        onChange={() => {}}
        ariaLabel="Mode d'affichage"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Vue détaillée' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Vue compacte' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked value', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[...options]}
        value="compact"
        onChange={onChange}
        ariaLabel="Mode d'affichage"
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Vue détaillée' }),
    );
    expect(onChange).toHaveBeenCalledWith('detailed');
  });

  it('exposes the group label', () => {
    render(
      <SegmentedControl
        options={[...options]}
        value="compact"
        onChange={() => {}}
        ariaLabel="Mode d'affichage"
      />,
    );
    expect(
      screen.getByRole('group', { name: "Mode d'affichage" }),
    ).toBeInTheDocument();
  });
});
