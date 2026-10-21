import { Card } from '@components/card/Card';
import { useRepositoriesContext } from './context/useRepositoriesContext';
import './scanErrorsNotice.less';

/** Dossiers de scan illisibles, signalés au-dessus de la liste. */
export const ScanErrorsNotice = () => {
  const { list } = useRepositoriesContext();
  if (list.scanErrors.length === 0) return null;
  return (
    <Card title="Dossiers illisibles" tone="alert">
      <ul className="pp-scan-errors-notice-list">
        {list.scanErrors.map((error) => (
          <li key={error.path}>
            <code>{error.path}</code> : {error.message}
          </li>
        ))}
      </ul>
    </Card>
  );
};
