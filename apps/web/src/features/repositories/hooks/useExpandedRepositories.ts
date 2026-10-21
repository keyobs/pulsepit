import type { ViewMode } from '@constants/viewModes';
import { useCallback, useState } from 'react';

/** Dépôts dont le panneau est ouvert, et mode d'affichage (compact : tout fermé, détaillé : tout ouvert). */
export function useExpandedRepositories() {
  const [viewMode, setViewModeState] = useState<ViewMode>('compact');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isExpanded = useCallback(
    (path: string) => expanded.has(path),
    [expanded],
  );

  const toggle = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const setViewMode = useCallback((mode: ViewMode, paths: string[]) => {
    setViewModeState(mode);
    setExpanded(mode === 'detailed' ? new Set(paths) : new Set());
  }, []);

  return { viewMode, setViewMode, isExpanded, toggle };
}
