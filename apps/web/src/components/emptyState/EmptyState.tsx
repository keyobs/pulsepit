import type { ReactNode } from 'react';
import './emptyState.less';

interface EmptyStateProps {
  children: ReactNode;
}

export const EmptyState = ({ children }: EmptyStateProps) => (
  <div className="pp-empty-state">{children}</div>
);
