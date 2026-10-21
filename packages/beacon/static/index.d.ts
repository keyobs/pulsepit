import type { BeaconManifest, BeaconOptions } from '../dist/index.js';

export function writeBeaconManifest(
  outputPath: string,
  options: BeaconOptions,
): Promise<BeaconManifest>;
