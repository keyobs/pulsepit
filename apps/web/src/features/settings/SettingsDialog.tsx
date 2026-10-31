import { getSettings, saveSettings } from '@api/settings.api';
import { Button } from '@components/button/Button';
import { Dialog } from '@components/dialog/Dialog';
import { Spinner } from '@components/spinner/Spinner';
import { useAsyncAction } from '@hooks/useAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { useEffect, useState } from 'react';
import { useRepositoriesContext } from '../repositories/context/useRepositoriesContext';
import { PushLocksSection } from './PushLocksSection';
import { RescanSection } from './RescanSection';
import { ScanPathsSection } from './ScanPathsSection';
import { fromDraft, type SettingsDraft, toDraft } from './settingsDraft';
import './settingsDialog.less';

interface SettingsDialogProps {
  onClose: () => void;
}

export const SettingsDialog = ({ onClose }: SettingsDialogProps) => {
  const { list } = useRepositoriesContext();
  const { showToast } = useToast();
  const loading = useAsyncAction(getSettings);
  const saving = useAsyncAction(saveSettings);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const loadSettings = loading.run;

  useEffect(() => {
    void loadSettings().then((response) => {
      if (response) setDraft(toDraft(response.settings));
    });
  }, [loadSettings]);

  const response = loading.data;
  const update = (patch: Partial<SettingsDraft>) =>
    setDraft((current) => current && { ...current, ...patch });

  const save = async () => {
    if (!draft) return;
    const saved = await saving.run(fromDraft(draft));
    if (!saved) return;
    showToast('Réglages enregistrés.');
    void list.reload();
    onClose();
  };

  return (
    <Dialog
      title="Réglages"
      onClose={onClose}
      footer={
        <>
          {saving.error && (
            <span className="pp-settings-error">
              {describeApiError(saving.error)}
            </span>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={saving.isLoading}
            disabled={!draft}
            onClick={() => void save()}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      {loading.error && !draft && (
        <p className="pp-settings-error">{describeApiError(loading.error)}</p>
      )}
      {!draft || !response ? (
        !loading.error && <Spinner />
      ) : (
        <>
          <ScanPathsSection
            paths={draft.scanPaths}
            envPaths={
              response.scanPathsSource === 'env'
                ? response.effectiveScanPaths
                : []
            }
            onChange={(scanPaths) => update({ scanPaths })}
          />
          <RescanSection
            value={draft.rescan}
            state={response.rescan}
            onChange={(rescan) => update({ rescan })}
          />
          <PushLocksSection
            value={draft}
            repositories={list.repositories}
            onChange={update}
          />
        </>
      )}
    </Dialog>
  );
};
