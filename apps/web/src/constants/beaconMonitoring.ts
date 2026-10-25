/** Fréquence de lecture de l'état de surveillance par le front (lecture en mémoire côté API). */
export const BEACON_MONITORING_REFRESH_MS = 30_000;

export const BEACON_MONITORING_INTERVAL_LABELS = {
  '5m': 'toutes les 5 min',
  '15m': 'toutes les 15 min',
  '30m': 'toutes les 30 min',
  '1h': 'toutes les heures',
} as const;
