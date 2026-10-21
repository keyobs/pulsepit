import { Popover } from '@components/popover/Popover';
import './scanFolders.less';

interface ScanFoldersProps {
  paths: string[];
}

/** Dossiers scannés : une ligne s'il n'y en a qu'un, sinon une liste repliée qui flotte au-dessus du contenu. */
export const ScanFolders = ({ paths }: ScanFoldersProps) => {
  if (paths.length === 0)
    return <div className="pp-scan-folders">Aucun dossier scanné</div>;
  if (paths.length === 1) {
    return <div className="pp-scan-folders">Dossier scanné : {paths[0]}</div>;
  }
  return (
    <div className="pp-scan-folders">
      <Popover
        renderTrigger={({ isOpen, toggle }) => (
          <button
            type="button"
            className="pp-scan-folders-trigger"
            aria-expanded={isOpen}
            onClick={toggle}
          >
            {paths.length} dossiers scannés
          </button>
        )}
      >
        <ul className="pp-scan-folders-list">
          {paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </Popover>
    </div>
  );
};
