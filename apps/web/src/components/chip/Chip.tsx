import { cleanClasses } from '@utils/cleanClasses';
import type { ReactNode } from 'react';
import './chip.less';

interface ChipProps {
  variant?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}

export const Chip = ({
  variant = 'neutral',
  icon,
  title,
  children,
}: ChipProps) => (
  <span className={cleanClasses('pp-chip', variant)} title={title}>
    {icon}
    {children}
  </span>
);
