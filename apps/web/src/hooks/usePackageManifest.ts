import { PACKAGE_QUERY } from '@api/queryClient';
import { getPackage } from '@api/repositories.api';
import type { PackageRef } from '@api/types';
import { useQuery } from '@tanstack/react-query';

/** package.json d'un dépôt ou d'un workspace, gardé en cache le temps de la session. */
export const usePackageManifest = (
  path: string,
  workspace?: string,
  ref: PackageRef = 'head',
  enabled = true,
) =>
  useQuery({
    queryKey: [PACKAGE_QUERY, path, workspace ?? '.', ref],
    queryFn: () => getPackage(path, ref, workspace),
    enabled,
  });
