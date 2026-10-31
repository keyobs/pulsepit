import type { Repository } from '@api/types';
import { IconButton } from '@components/iconButton/IconButton';
import { repositoryName } from '@utils/repositoryName';
import { TbTrash } from 'react-icons/tb';
import type { RepositoryLockDraft, SettingsDraft } from './settingsDraft';

type LocksDraft = Pick<
  SettingsDraft,
  'lockAll' | 'lockedBranches' | 'repositories'
>;

interface PushLocksSectionProps {
  value: LocksDraft;
  repositories: Repository[];
  onChange: (value: LocksDraft) => void;
}

/** Verrous de push appliqués par Pulsepit (un `git push` en terminal reste possible). */
export const PushLocksSection = ({
  value,
  repositories,
  onChange,
}: PushLocksSectionProps) => {
  const available = repositories.filter(
    ({ path }) => !value.repositories.some((lock) => lock.path === path),
  );
  const updateLock = (path: string, patch: Partial<RepositoryLockDraft>) =>
    onChange({
      ...value,
      repositories: value.repositories.map((lock) =>
        lock.path === path ? { ...lock, ...patch } : lock,
      ),
    });

  return (
    <section className="pp-settings-section">
      <h3>Verrous de push</h3>
      <p className="pp-muted-text">
        Bloque les push lancés depuis Pulsepit. Branches séparées par des
        virgules.
      </p>
      <label className="pp-settings-check">
        <input
          type="checkbox"
          checked={value.lockAll}
          onChange={(event) =>
            onChange({ ...value, lockAll: event.target.checked })
          }
        />
        Tout bloquer (tous les dépôts, toutes les branches)
      </label>
      <label className="pp-settings-field">
        <span>Branches bloquées dans tous les dépôts</span>
        <input
          className="pp-settings-input"
          placeholder="main, develop"
          value={value.lockedBranches}
          disabled={value.lockAll}
          onChange={(event) =>
            onChange({ ...value, lockedBranches: event.target.value })
          }
        />
      </label>

      {value.repositories.length > 0 && (
        <ul className="pp-settings-list">
          {value.repositories.map((lock) => (
            <li key={lock.path} className="pp-settings-lock">
              <span className="pp-settings-path" title={lock.path}>
                {repositoryName(lock.path)}
              </span>
              <label className="pp-settings-check">
                <input
                  type="checkbox"
                  checked={lock.all}
                  disabled={value.lockAll}
                  onChange={(event) =>
                    updateLock(lock.path, { all: event.target.checked })
                  }
                />
                Toutes
              </label>
              <input
                className="pp-settings-input"
                placeholder="main, develop"
                aria-label={`Branches bloquées pour ${repositoryName(lock.path)}`}
                value={lock.branches}
                disabled={value.lockAll || lock.all}
                onChange={(event) =>
                  updateLock(lock.path, { branches: event.target.value })
                }
              />
              <IconButton
                icon={<TbTrash />}
                label={`Retirer le verrou de ${repositoryName(lock.path)}`}
                size="small"
                onClick={() =>
                  onChange({
                    ...value,
                    repositories: value.repositories.filter(
                      (item) => item.path !== lock.path,
                    ),
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <select
        className="pp-settings-input"
        aria-label="Ajouter un verrou pour un dépôt"
        value=""
        disabled={value.lockAll || available.length === 0}
        onChange={(event) =>
          onChange({
            ...value,
            repositories: [
              ...value.repositories,
              { path: event.target.value, all: false, branches: '' },
            ],
          })
        }
      >
        <option value="" disabled>
          Ajouter un verrou pour un dépôt…
        </option>
        {available.map((repository) => (
          <option key={repository.path} value={repository.path}>
            {repository.name}
          </option>
        ))}
      </select>
    </section>
  );
};
