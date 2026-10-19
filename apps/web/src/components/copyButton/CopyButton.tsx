import { IconButton } from '@components/iconButton/IconButton';
import { useClipboard } from '@hooks/useClipboard';
import { TbCheck, TbCopy } from 'react-icons/tb';

interface CopyButtonProps {
  value: string;
  label?: string;
  onCopied?: () => void;
  onError?: () => void;
}

export const CopyButton = ({
  value,
  label = 'Copier le lien',
  onCopied,
  onError,
}: CopyButtonProps) => {
  const { copy, copied } = useClipboard();

  const handleClick = async () => {
    const success = await copy(value);
    if (success) onCopied?.();
    else onError?.();
  };

  return (
    <IconButton
      icon={
        copied ? <TbCheck aria-hidden="true" /> : <TbCopy aria-hidden="true" />
      }
      label={label}
      onClick={handleClick}
    />
  );
};
