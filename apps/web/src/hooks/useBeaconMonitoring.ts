import { getBeaconMonitoring } from '@api/repositories.api';
import type { BeaconMonitoringEnvironment } from '@api/types';
import { BEACON_MONITORING_REFRESH_MS } from '@constants/beaconMonitoring';
import { useEffect } from 'react';
import { useAsyncAction } from './useAsyncAction';

/** États de surveillance des balises d'un dépôt, relus à intervalle régulier tant que le composant est monté. */
export function useBeaconMonitoring(
  path: string,
): BeaconMonitoringEnvironment[] {
  const { data, run } = useAsyncAction(getBeaconMonitoring);

  useEffect(() => {
    void run();
    const timer = setInterval(() => void run(), BEACON_MONITORING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [run]);

  return data?.environments.filter((item) => item.path === path) ?? [];
}
