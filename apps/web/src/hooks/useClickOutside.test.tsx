import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { useClickOutside } from './useClickOutside';

function Probe({
  onOutside,
  enabled,
}: {
  onOutside: () => void;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onOutside, enabled);
  return (
    <div>
      <div ref={ref}>inside</div>
      <span>outside</span>
    </div>
  );
}

describe('useClickOutside', () => {
  it('calls the handler on an outside click only', async () => {
    const onOutside = vi.fn();
    const { getByText } = render(<Probe onOutside={onOutside} />);
    await userEvent.click(getByText('inside'));
    expect(onOutside).not.toHaveBeenCalled();
    await userEvent.click(getByText('outside'));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const onOutside = vi.fn();
    const { getByText } = render(
      <Probe onOutside={onOutside} enabled={false} />,
    );
    await userEvent.click(getByText('outside'));
    expect(onOutside).not.toHaveBeenCalled();
  });
});
