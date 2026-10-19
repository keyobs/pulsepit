import type { ReactNode } from 'react';
import './segmentedControl.less';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) => (
  <fieldset className="pp-segmented-control" aria-label={ariaLabel}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.icon}
        {option.label}
      </button>
    ))}
  </fieldset>
);
