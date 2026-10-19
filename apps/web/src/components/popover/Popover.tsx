import { useClickOutside } from '@hooks/useClickOutside';
import { useDisclosure } from '@hooks/useDisclosure';
import { cleanClasses } from '@utils/cleanClasses';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import './popover.less';

interface TriggerState {
  isOpen: boolean;
  toggle: () => void;
}

interface PopoverProps {
  renderTrigger: (state: TriggerState) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
}

/** Panneau flottant qui se superpose au contenu et se ferme au clic extérieur ou sur Échap. */
export const Popover = ({
  renderTrigger,
  children,
  align = 'start',
}: PopoverProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const { isOpen, close, toggle } = useDisclosure();

  useClickOutside(ref, close, isOpen);

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    },
    [close],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  return (
    <div className="pp-popover" ref={ref}>
      {renderTrigger({ isOpen, toggle })}
      {isOpen && (
        <div className={cleanClasses('pp-popover-panel', align)}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
};
