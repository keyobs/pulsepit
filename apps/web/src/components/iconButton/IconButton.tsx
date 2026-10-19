import { Button, type ButtonProps } from '@components/button/Button';
import type { ReactNode } from 'react';

interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  icon: ReactNode;
  label: string;
}

export const IconButton = ({ icon, label, ...rest }: IconButtonProps) => (
  <Button {...rest} icon={icon} aria-label={label} title={label} />
);
