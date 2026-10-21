import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createBeaconManifest } from '../dist/index.js';

/** Writes only validated public metadata; the caller supplies its destination. */
export async function writeBeaconManifest(outputPath, options) {
  const manifest = createBeaconManifest(options);
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}
