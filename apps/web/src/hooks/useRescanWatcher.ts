import { getSettings } from '@api/settings.api';
import { RESCAN_WATCH_MS } from '@constants/settings';
import { useEffect, useRef } from 'react';

/** Appelle `onCycle` à chaque fin de fetch programmé terminé après le montage. */
export function useRescanWatcher(onCycle: () => void) {
  const callback = useRef(onCycle);

  useEffect(() => {
    callback.current = onCycle;
  }, [onCycle]);

  useEffect(() => {
    let seen: string | null | undefined;
    const check = async () => {
      try {
        const { rescan } = await getSettings();
        const finished = rescan.lastFinishedAt;
        if (seen !== undefined && finished && finished !== seen)
          callback.current();
        seen = finished;
      } catch {
        // API indisponible : nouvel essai au prochain tick.
      }
    };
    void check();
    const timer = setInterval(() => void check(), RESCAN_WATCH_MS);
    return () => clearInterval(timer);
  }, []);
}
