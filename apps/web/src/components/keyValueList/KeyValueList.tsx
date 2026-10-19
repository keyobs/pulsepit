import type { ReactNode } from 'react';
import './keyValueList.less';

interface KeyValueItem {
  label: string;
  value: ReactNode;
}

interface KeyValueListProps {
  items: KeyValueItem[];
}

export const KeyValueList = ({ items }: KeyValueListProps) => (
  <dl className="pp-key-value-list">
    {items.map((item) => (
      <div key={item.label} className="pp-key-value-list-row">
        <dt>{item.label}</dt>
        <dd>{item.value}</dd>
      </div>
    ))}
  </dl>
);
