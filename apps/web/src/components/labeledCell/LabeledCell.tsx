import type { ReactNode } from 'react';
import './labeledCell.less';

interface LabeledCellProps {
  label: string;
  children: ReactNode;
}

export const LabeledCell = ({ label, children }: LabeledCellProps) => (
  <div className="pp-labeled-cell">
    <div className="pp-labeled-cell-label">{label}</div>
    {children}
  </div>
);
