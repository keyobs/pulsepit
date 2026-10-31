import { IconButton } from '@components/iconButton/IconButton';
import { type ReactNode, useEffect, useId } from 'react';
import { TbX } from 'react-icons/tb';
import './dialog.less';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Fenêtre modale centrée, fermée par Échap, le fond ou la croix. */
export const Dialog = ({ title, onClose, children, footer }: DialogProps) => {
  const titleId = useId();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="pp-dialog-backdrop">
      <button
        type="button"
        className="pp-dialog-overlay"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className="pp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="pp-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton
            icon={<TbX />}
            label="Fermer"
            size="small"
            onClick={onClose}
          />
        </header>
        <div className="pp-dialog-body">{children}</div>
        {footer && <footer className="pp-dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
};
