import { CopyButton } from '@components/copyButton/CopyButton';
import { TruncatedLink } from '@components/truncatedLink/TruncatedLink';
import './linkRow.less';

interface LinkRowProps {
  url: string;
  label?: string;
  onBlockedClick?: () => void;
  onCopied?: () => void;
  onCopyError?: () => void;
}

/** Lien tronqué suivi d'un bouton de copie. */
export const LinkRow = ({
  url,
  label,
  onBlockedClick,
  onCopied,
  onCopyError,
}: LinkRowProps) => (
  <div className="pp-link-row">
    <TruncatedLink href={url} label={label} onBlockedClick={onBlockedClick} />
    <CopyButton value={url} onCopied={onCopied} onError={onCopyError} />
  </div>
);
