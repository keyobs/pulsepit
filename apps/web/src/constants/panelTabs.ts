import type { TabItem } from '@components/tabs/Tabs';

export type PanelTabId =
  | 'git'
  | 'gitTree'
  | 'dependencies'
  | 'beacon'
  | 'deployment'
  | 'errors'
  | 'resources';

export const PANEL_TABS: TabItem<PanelTabId>[] = [
  { id: 'git', label: 'Git' },
  { id: 'gitTree', label: 'Git Tree' },
  { id: 'dependencies', label: 'Dépendances' },
  { id: 'beacon', label: 'Beacon' },
  { id: 'deployment', label: 'Déploiement' },
  { id: 'errors', label: 'Erreurs', badge: 'v2' },
  { id: 'resources', label: 'Ressources', badge: 'v2' },
];
