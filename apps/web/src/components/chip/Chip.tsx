import { cleanClasses } from '@utils/cleanClasses';
import type { ReactNode } from 'react';
import './chip.less';

interface ChipProps {
  variant?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
  icon?: ReactNode;
  title?: string;
  truncate?: boolean;
  children: ReactNode;
}

export const Chip = ({
  variant = 'neutral',
  icon,
  title,
  truncate = false,
  children,
}: ChipProps) => (
  <span
    className={cleanClasses('pp-chip', variant, truncate && 'truncated')}
    title={title}
  >
    {icon}
    {truncate ? <span className="pp-chip-text">{children}</span> : children}
  </span>
);
