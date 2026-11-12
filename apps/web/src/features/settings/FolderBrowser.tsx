import { ApiError } from '@api/apiError';
import { listDirectories } from '@api/directories.api';
import { Button } from '@components/button/Button';
import { IconButton } from '@components/iconButton/IconButton';
import { Spinner } from '@components/spinner/Spinner';
import { useAsyncAction } from '@hooks/useAsyncAction';
import { describeApiError } from '@utils/describeApiError';
import { useEffect } from 'react';
import { TbArrowUp, TbBrandGit, TbCheck, TbFolder, TbX } from 'react-icons/tb';
import './folderBrowser.less';

interface FolderBrowserProps {
  onPick: (path: string) => void;
  onClose: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  ENOENT: 'Ce dossier n’existe pas.',
  ENOTDIR: 'Ce chemin n’est pas un dossier.',
  EACCES: 'Accès refusé à ce dossier.',
  EPERM: 'Accès refusé à ce dossier.',
};

function describeError(error: Error) {
  if (error instanceof ApiError && ERROR_MESSAGES[error.code])
    return ERROR_MESSAGES[error.code];
  return describeApiError(error);
}

function toCrumbs(path: string) {
  const parts = path.split('/').filter(Boolean);
  return [
    { label: '/', path: '/' },
    ...parts.map((label, index) => ({
      label,
      path: `/${parts.slice(0, index + 1).join('/')}`,
    })),
  ];
}

export const FolderBrowser = ({ onPick, onClose }: FolderBrowserProps) => {
  const { data, error, isLoading, run } = useAsyncAction(listDirectories);

  useEffect(() => {
    void run();
  }, [run]);

  const open = (path: string) => void run(path);

  return (
    <div className="pp-folder-browser">
      <div className="pp-folder-browser-bar">
        <IconButton
          icon={<TbArrowUp />}
          label="Dossier parent"
          size="small"
          disabled={!data?.parent || isLoading}
          onClick={() => data?.parent && open(data.parent)}
        />
        <nav className="pp-folder-browser-crumbs" aria-label="Chemin">
          {data &&
            toCrumbs(data.path).map((crumb) => (
              <button
                key={crumb.path}
                type="button"
                onClick={() => open(crumb.path)}
              >
                {crumb.label}
              </button>
            ))}
        </nav>
        <IconButton
          icon={<TbX />}
          label="Fermer l’explorateur"
          size="small"
          onClick={onClose}
        />
      </div>

      {error && <p className="pp-settings-error">{describeError(error)}</p>}

      {isLoading && !data ? (
        <Spinner />
      ) : (
        data && (
          <ul className="pp-folder-browser-list" aria-busy={isLoading}>
            {data.directories.length === 0 && (
              <li className="pp-muted-text">Aucun sous-dossier.</li>
            )}
            {data.directories.map((directory) => (
              <li key={directory.path}>
                <button type="button" onClick={() => open(directory.path)}>
                  {directory.isGitRepo ? (
                    <TbBrandGit aria-label="Dépôt Git" />
                  ) : (
                    <TbFolder aria-hidden />
                  )}
                  <span>{directory.name}</span>
                </button>
              </li>
            ))}
            {data.truncated && (
              <li className="pp-muted-text">Liste tronquée à 500 dossiers.</li>
            )}
          </ul>
        )
      )}

      <div className="pp-folder-browser-actions">
        <Button
          variant="primary"
          size="small"
          icon={<TbCheck />}
          disabled={!data || isLoading}
          onClick={() => data && onPick(data.path)}
        >
          Choisir ce dossier
        </Button>
      </div>
    </div>
  );
};
