export type RepositoryFilter = 'all' | 'dirty' | 'offline' | 'outdated';

export const REPOSITORY_FILTERS: Array<{
  value: RepositoryFilter;
  label: string;
}> = [
  { value: 'all', label: 'Tous' },
  { value: 'dirty', label: 'Modifiés' },
  { value: 'offline', label: 'Hors ligne' },
  { value: 'outdated', label: 'Obsolètes' },
];
