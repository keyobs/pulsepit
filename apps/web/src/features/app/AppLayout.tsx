import { AppHeader } from '../header/AppHeader';
import { ListHead } from '../repositories/ListHead';
import { RepositoryFilters } from '../repositories/RepositoryFilters';
import { RepositoryList } from '../repositories/RepositoryList';
import { ScanErrorsNotice } from '../repositories/ScanErrorsNotice';
import { SummaryBar } from '../summary/SummaryBar';
import './appLayout.less';

export const AppLayout = () => (
  <div className="pp-app-layout">
    <AppHeader />
    <SummaryBar />
    <ScanErrorsNotice />
    <RepositoryFilters />
    <ListHead />
    <main>
      <RepositoryList />
    </main>
  </div>
);
