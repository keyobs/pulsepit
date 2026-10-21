import { BEACON_PACKAGE_NAME } from '@constants/beacon';
import { useEffect } from 'react';
import { usePackageManifest } from './usePackageManifest';

const declaredVersion = (
  manifest: Record<string, unknown>,
  table: 'dependencies' | 'devDependencies',
): string | null => {
  const entries = manifest[table];
  if (typeof entries !== 'object' || entries === null) return null;
  const version = (entries as Record<string, unknown>)[BEACON_PACKAGE_NAME];
  return typeof version === 'string' && version.length > 0 ? version : null;
};

export function useBeaconVersion(path: string, enabled: boolean) {
  const { data, status, run } = usePackageManifest(path);

  useEffect(() => {
    if (enabled) void run('head');
  }, [enabled, run]);

  const version = data
    ? (declaredVersion(data.manifest, 'dependencies') ??
      declaredVersion(data.manifest, 'devDependencies'))
    : null;

  return {
    version,
    isLoading: enabled && (status === 'idle' || status === 'loading'),
  };
}
