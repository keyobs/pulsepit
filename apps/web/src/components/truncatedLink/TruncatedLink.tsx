import type { MouseEvent } from 'react';
import './truncatedLink.less';

interface TruncatedLinkProps {
  href: string;
  label?: string;
  onBlockedClick?: () => void;
}

/** Lien en forme de bouton, au texte tronqué. Il ne s'ouvre qu'avec Ctrl+clic (ou Cmd+clic). */
export const TruncatedLink = ({
  href,
  label = href,
  onBlockedClick,
}: TruncatedLinkProps) => {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    onBlockedClick?.();
  };

  return (
    <a
      className="pp-truncated-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Ctrl+clic pour ouvrir : ${href}`}
      onClick={handleClick}
    >
      <span className="pp-truncated-link-text">{label}</span>
    </a>
  );
};
