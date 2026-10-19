import { Button } from '@components/button/Button';
import { Popover } from '@components/popover/Popover';
import type { ReactNode } from 'react';
import './dropdownMenu.less';

export interface DropdownMenuItem {
  id: string;
  label: string;
  hint?: string;
}

interface DropdownMenuProps {
  label: string;
  icon?: ReactNode;
  header?: string;
  items: DropdownMenuItem[];
  emptyText?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

export const DropdownMenu = ({
  label,
  icon,
  header,
  items,
  emptyText = 'Aucun élément',
  disabled,
  onSelect,
}: DropdownMenuProps) => (
  <Popover
    align="end"
    renderTrigger={({ isOpen, toggle }) => (
      <Button
        icon={icon}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        {label} ▾
      </Button>
    )}
  >
    {(close) => (
      <div className="pp-dropdown-menu" role="menu">
        {header && <div className="pp-dropdown-menu-header">{header}</div>}
        {items.length === 0 && (
          <div className="pp-dropdown-menu-header">{emptyText}</div>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="pp-dropdown-menu-item"
            onClick={() => {
              close();
              onSelect(item.id);
            }}
          >
            {item.label}
            {item.hint && (
              <span className="pp-dropdown-menu-hint">{item.hint}</span>
            )}
          </button>
        ))}
      </div>
    )}
  </Popover>
);
