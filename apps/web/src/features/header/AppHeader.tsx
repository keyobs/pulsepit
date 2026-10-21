import { useRepositoriesContext } from '../repositories/context/useRepositoriesContext';
import { AppBrand } from './AppBrand';
import { Clock } from './Clock';
import { HeaderActions } from './HeaderActions';
import { ScanFolders } from './ScanFolders';
import './appHeader.less';

export const AppHeader = () => {
  const { list } = useRepositoriesContext();
  return (
    <header className="pp-app-header">
      <div className="pp-app-header-info">
        <div className="pp-app-header-top">
          <AppBrand />
          <Clock />
        </div>
        <ScanFolders paths={list.scanPaths} />
      </div>
      <HeaderActions />
    </header>
  );
};
