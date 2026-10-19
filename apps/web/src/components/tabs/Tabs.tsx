import { cleanClasses } from '@utils/cleanClasses';
import type { ReactNode } from 'react';
import './tabs.less';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  badge?: string;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

export const Tabs = <T extends string>({
  items,
  activeId,
  onChange,
  ariaLabel,
}: TabsProps<T>) => (
  <div className="pp-tabs" role="tablist" aria-label={ariaLabel}>
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={item.id === activeId}
        className={cleanClasses('pp-tabs-tab', item.badge && 'with-badge')}
        onClick={() => onChange(item.id)}
      >
        {item.label}
        {item.badge && <em className="pp-tabs-badge">{item.badge}</em>}
      </button>
    ))}
  </div>
);
