import { Chip } from '@components/chip/Chip';
import type { ReactNode } from 'react';
import './placeholderBox.less';

interface PlaceholderBoxProps {
  title: string;
  badge?: string;
  children: ReactNode;
}

/** Zone en pointillés pour une fonctionnalité prévue mais pas encore disponible. */
export const PlaceholderBox = ({
  title,
  badge,
  children,
}: PlaceholderBoxProps) => (
  <div className="pp-placeholder-box">
    <h4 className="pp-placeholder-box-title">
      {title} {badge && <Chip>{badge}</Chip>}
    </h4>
    {children}
  </div>
);
