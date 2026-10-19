import { cleanClasses } from '@utils/cleanClasses';
import type { ReactNode } from 'react';
import './card.less';

interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: 'default' | 'alert';
  children: ReactNode;
}

export const Card = ({
  title,
  actions,
  tone = 'default',
  children,
}: CardProps) => (
  <section className={cleanClasses('pp-card', tone)}>
    {(title || actions) && (
      <header className="pp-card-header">
        {title && <h4 className="pp-card-title">{title}</h4>}
        {actions}
      </header>
    )}
    {children}
  </section>
);
