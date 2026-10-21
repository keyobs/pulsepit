import { IconLink } from '@components/iconLink/IconLink';
import { useToast } from '@hooks/useToast';
import { buildVscodeUrl } from '@utils/editorUrl';
import { TbBrandVscode } from 'react-icons/tb';

interface OpenInEditorButtonProps {
  path: string;
}

export const OpenInEditorButton = ({ path }: OpenInEditorButtonProps) => {
  const { showToast } = useToast();
  return (
    <IconLink
      size="small"
      href={buildVscodeUrl(path)}
      label="Ouvrir dans VS Code"
      icon={<TbBrandVscode aria-hidden="true" />}
      onClick={() => showToast('Ouverture dans VS Code…')}
    />
  );
};
