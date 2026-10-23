import type { CheckExecution, ChecksOperation } from '@api/types';
import { Chip } from '@components/chip/Chip';
import { API_ERROR_MESSAGES } from '@constants/apiErrorMessages';
import './checksStatus.less';

type Variant = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';

const CHECK_LABELS: Record<CheckExecution['status'], [string, Variant]> = {
  pending: ['En attente', 'neutral'],
  running: ['En cours', 'accent'],
  passed: ['Réussi', 'ok'],
  failed: ['Échec', 'bad'],
  cancelled: ['Annulé', 'warn'],
  timed_out: ['Délai dépassé', 'bad'],
};

const OPERATION_LABELS: Record<ChecksOperation['status'], [string, Variant]> = {
  queued: ['En file', 'neutral'],
  running: ['En cours', 'accent'],
  succeeded: ['Contrôles réussis', 'ok'],
  failed: ['Contrôles en échec', 'bad'],
  cancelled: ['Contrôles annulés', 'warn'],
  timed_out: ['Contrôles : délai dépassé', 'bad'],
};

const PUSH_LABELS: Record<
  NonNullable<ChecksOperation['push']>['status'],
  [string, Variant]
> = {
  running: ['Push en cours', 'accent'],
  succeeded: ['Push réalisé', 'ok'],
  failed: ['Push en échec', 'bad'],
};

interface ChecksStatusProps {
  operation: ChecksOperation;
}

/** Contrôles et push sont deux résultats distincts : un succès des contrôles n'est jamais un push. */
export const ChecksStatus = ({ operation }: ChecksStatusProps) => {
  const [label, variant] = OPERATION_LABELS[operation.status];
  const pushError = operation.push?.error;
  return (
    <div className="pp-checks-status">
      <div className="pp-checks-status-head">
        <span className="pp-checks-status-branch">{operation.branch}</span>
        <Chip variant={variant}>{label}</Chip>
        {operation.push && (
          <Chip variant={PUSH_LABELS[operation.push.status][1]}>
            {PUSH_LABELS[operation.push.status][0]}
          </Chip>
        )}
      </div>
      <ul className="pp-checks-status-list">
        {operation.checks.map((check) => (
          <li key={check.checkId}>
            <span className="mono">{check.checkId}</span>
            {!check.required && ' (consultatif)'}{' '}
            <Chip variant={CHECK_LABELS[check.status][1]}>
              {CHECK_LABELS[check.status][0]}
            </Chip>
          </li>
        ))}
      </ul>
      {operation.error && (
        <p className="pp-checks-status-error">
          {API_ERROR_MESSAGES[operation.error.code] ?? operation.error.message}
        </p>
      )}
      {pushError && (
        <p className="pp-checks-status-error">
          {API_ERROR_MESSAGES[pushError.code] ?? pushError.message}
        </p>
      )}
    </div>
  );
};
