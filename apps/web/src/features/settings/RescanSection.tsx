import type { RescanInterval, Settings, SettingsResponse } from '@api/types';
import { RESCAN_INTERVALS } from '@constants/settings';
import { formatRelativeTime } from '@utils/formatDate';
import { repositoryName } from '@utils/repositoryName';

interface RescanSectionProps {
  value: Settings['rescan'];
  state: SettingsResponse['rescan'] | null;
  onChange: (value: Settings['rescan']) => void;
}

/** Fetch automatique de tous les dépôts, sans pull. */
export const RescanSection = ({
  value,
  state,
  onChange,
}: RescanSectionProps) => (
  <section className="pp-settings-section">
    <h3>Fetch automatique</h3>
    <div className="pp-settings-inline">
      <label className="pp-settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
        />
        Fetch de tous les dépôts toutes les
      </label>
      <select
        className="pp-settings-input"
        aria-label="Intervalle du fetch automatique"
        value={value.interval}
        disabled={!value.enabled}
        onChange={(event) =>
          onChange({ ...value, interval: event.target.value as RescanInterval })
        }
      >
        {RESCAN_INTERVALS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
    <p className="pp-muted-text">
      Met à jour les branches distantes connues, sans toucher aux branches
      locales.
      {state?.lastFinishedAt &&
        ` Dernier cycle ${formatRelativeTime(state.lastFinishedAt)}.`}
    </p>
    {state && state.failures.length > 0 && (
      <p className="pp-settings-error">
        Échec :{' '}
        {state.failures.map(({ path }) => repositoryName(path)).join(', ')}
      </p>
    )}
  </section>
);
