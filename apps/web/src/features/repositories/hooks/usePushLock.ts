import { getSettings, saveSettings } from '@api/settings.api';
import { useAsyncAction } from '@hooks/useAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { useEffect, useState } from 'react';
import {
  type PushLockScope,
  pushLockScope,
  toggleBranchLock,
} from '../../settings/pushLockSettings';

/** Verrous de push d'un dépôt, modifiables branche par branche depuis l'onglet Git. */
export function usePushLock(path: string, onChange: () => void) {
  const { showToast } = useToast();
  const { data, run } = useAsyncAction(getSettings);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void run();
  }, [run]);

  const scopeOf = (branch: string): PushLockScope | null =>
    data ? pushLockScope(data.settings, path, branch) : null;

  const toggle = async (branch: string) => {
    setSaving(branch);
    try {
      // Relecture juste avant l'écriture : le PUT remplace tous les réglages.
      const { settings } = await getSettings();
      await saveSettings(toggleBranchLock(settings, path, branch));
      await run();
      onChange();
    } catch (error) {
      showToast(describeApiError(error));
    } finally {
      setSaving(null);
    }
  };

  return { scopeOf, toggle, savingBranch: saving };
}
