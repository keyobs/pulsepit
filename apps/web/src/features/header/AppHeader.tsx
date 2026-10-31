import { IconButton } from '@components/iconButton/IconButton';
import { useDisclosure } from '@hooks/useDisclosure';
import { TbSettings } from 'react-icons/tb';
import { useRepositoriesContext } from '../repositories/context/useRepositoriesContext';
import { SettingsDialog } from '../settings/SettingsDialog';
import { AppBrand } from './AppBrand';
import { Clock } from './Clock';
import { HeaderActions } from './HeaderActions';
import { ScanFolders } from './ScanFolders';
import './appHeader.less';

export const AppHeader = () => {
  const { list } = useRepositoriesContext();
  const settings = useDisclosure();
  return (
    <header className="pp-app-header">
      <div className="pp-app-header-info">
        <div className="pp-app-header-top">
          <AppBrand />
          <Clock />
          <IconButton
            icon={<TbSettings />}
            label="Réglages"
            size="small"
            onClick={settings.open}
          />
          {settings.isOpen && <SettingsDialog onClose={settings.close} />}
        </div>
        <ScanFolders paths={list.scanPaths} />
      </div>
      <HeaderActions />
    </header>
  );
};
