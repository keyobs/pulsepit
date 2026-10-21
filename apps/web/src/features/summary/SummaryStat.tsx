import { cleanClasses } from '@utils/cleanClasses';
import './summaryStat.less';

interface SummaryStatProps {
  /** `null` : pas encore vérifié, affiché « — ». */
  value: number | null;
  label: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
}

export const SummaryStat = ({
  value,
  label,
  tone = 'neutral',
}: SummaryStatProps) => (
  <div className={cleanClasses('pp-summary-stat', tone)}>
    <b className="pp-summary-stat-value">{value ?? '—'}</b>
    <span className="pp-summary-stat-label">{label}</span>
  </div>
);
