import { getPackage } from '@api/repositories.api';
import type { PackageRef } from '@api/types';
import { useAsyncAction } from './useAsyncAction';

export const usePackageManifest = (path: string) =>
  useAsyncAction((ref: PackageRef = 'head') => getPackage(path, ref));
