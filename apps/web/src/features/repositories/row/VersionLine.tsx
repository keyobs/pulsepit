import { formatDateTime, formatRelativeTime } from '@utils/formatDate';
import type { ReactNode } from 'react';

interface VersionLineProps {
  chip: ReactNode;
  /** Date ISO associée à la ligne ; sans date, seule la pastille s'affiche. */
  iso?: string | null;
  caption?: string;
}

/** Une ligne de la grille des versions : pastille, puis date relative et légende. */
export const VersionLine = ({ chip, iso, caption }: VersionLineProps) => (
  <>
    {chip}
    {iso && caption ? (
      <span className="pp-versions-cell-date" title={formatDateTime(iso)}>
        <b>{formatRelativeTime(iso)}</b>
        <small>{caption}</small>
      </span>
    ) : (
      <span />
    )}
  </>
);
