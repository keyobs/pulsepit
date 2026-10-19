import { useToast } from '@hooks/useToast';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ToastProvider';

const Trigger = () => {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast('Lien copié')}>
      go
    </button>
  );
};

describe('ToastProvider', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the message then hides it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('go'));
    expect(screen.getByRole('status')).toHaveTextContent('Lien copié');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('throws when useToast is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow();
    spy.mockRestore();
  });
});
