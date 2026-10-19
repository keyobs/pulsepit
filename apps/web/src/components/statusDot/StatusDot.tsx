import { cleanClasses } from '@utils/cleanClasses';
import './statusDot.less';

interface StatusDotProps {
  status: 'ok' | 'bad' | 'warn' | 'off';
  label?: string;
}

export const StatusDot = ({ status, label }: StatusDotProps) => {
  const className = cleanClasses('pp-status-dot', status);
  if (label)
    return <span className={className} role="img" aria-label={label} />;
  return <span className={className} aria-hidden="true" />;
};
