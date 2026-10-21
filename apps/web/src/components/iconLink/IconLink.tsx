import { cleanClasses } from '@utils/cleanClasses';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import '@components/button/button.less';
import './iconLink.less';

interface IconLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  href: string;
  icon: ReactNode;
  label: string;
  size?: 'medium' | 'small';
}

/* Look like a button */
export const IconLink = ({
  href,
  icon,
  label,
  size = 'medium',
  className,
  ...rest
}: IconLinkProps) => (
  <a
    {...rest}
    href={href}
    className={cleanClasses(
      'pp-button',
      'default',
      size,
      'icon-only',
      'pp-icon-link',
      className,
    )}
    aria-label={label}
    title={label}
  >
    {icon}
  </a>
);
