import { Spinner } from '@components/spinner/Spinner';
import { cleanClasses } from '@utils/cleanClasses';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './button.less';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'default' | 'primary';
  size?: 'medium' | 'small';
  icon?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = ({
  variant = 'default',
  size = 'medium',
  icon,
  loading = false,
  disabled = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cleanClasses(
      'pp-button',
      variant,
      size,
      !children && 'icon-only',
      loading && 'loading',
      className,
    )}
  >
    {loading ? <Spinner /> : icon}
    {children && <span className="pp-button-label">{children}</span>}
  </button>
);
