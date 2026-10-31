import type { RescanInterval } from '@api/types';

/** Fréquence de lecture de l'état du fetch programmé (lecture en mémoire côté API). */
export const RESCAN_WATCH_MS = 60_000;

export const RESCAN_INTERVALS: { value: RescanInterval; label: string }[] = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 heure' },
  { value: '6h', label: '6 heures' },
];
