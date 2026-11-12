import { useClipboard } from '@hooks/useClipboard';
import { TbCheck } from 'react-icons/tb';

interface VersionCopyProps {
  label: string;
  command: string;
}

export const VersionCopy = ({ label, command }: VersionCopyProps) => {
  const { copy, copied } = useClipboard();
  return (
    <button
      type="button"
      className="pp-dependencies-tab-version"
      title={copied ? 'Commande copiée' : `Copier : ${command}`}
      onClick={() => void copy(command)}
    >
      {label}
      {copied && <TbCheck aria-hidden="true" />}
    </button>
  );
};
