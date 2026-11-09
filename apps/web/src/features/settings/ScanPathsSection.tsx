import { Button } from '@components/button/Button';
import { IconButton } from '@components/iconButton/IconButton';
import { useState } from 'react';
import { TbFolderOpen, TbPlus, TbTrash } from 'react-icons/tb';
import { FolderBrowser } from './FolderBrowser';

interface ScanPathsSectionProps {
  paths: string[];
  envPaths: string[];
  onChange: (paths: string[]) => void;
}

/** Dossiers scannés ; liste vide = dossiers du SCAN_PATH du .env. */
export const ScanPathsSection = ({
  paths,
  envPaths,
  onChange,
}: ScanPathsSectionProps) => {
  const [input, setInput] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const candidate = input.trim();

  const add = () => {
    if (!candidate || paths.includes(candidate)) return;
    onChange([...paths, candidate]);
    setInput('');
  };

  return (
    <section className="pp-settings-section">
      <h3>Dossiers scannés</h3>
      {paths.length === 0 ? (
        <p className="pp-muted-text">
          {envPaths.length
            ? `Dossiers du .env (SCAN_PATH) : ${envPaths.join(', ')}`
            : 'Liste vide : les dossiers SCAN_PATH du .env seront utilisés.'}
        </p>
      ) : (
        <ul className="pp-settings-list">
          {paths.map((path) => (
            <li key={path}>
              <span className="pp-settings-path">{path}</span>
              <IconButton
                icon={<TbTrash />}
                label={`Retirer ${path}`}
                size="small"
                onClick={() => onChange(paths.filter((item) => item !== path))}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="pp-settings-inline"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="pp-settings-input"
          placeholder="/home/moi/Projets"
          aria-label="Chemin absolu du dossier"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button
          type="submit"
          size="small"
          icon={<TbPlus />}
          disabled={!candidate}
        >
          Ajouter
        </Button>
        <Button
          size="small"
          icon={<TbFolderOpen />}
          aria-expanded={browsing}
          onClick={() => setBrowsing((open) => !open)}
        >
          Parcourir…
        </Button>
      </form>
      {browsing && (
        <FolderBrowser
          onPick={(path) => {
            if (!paths.includes(path)) onChange([...paths, path]);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </section>
  );
};
