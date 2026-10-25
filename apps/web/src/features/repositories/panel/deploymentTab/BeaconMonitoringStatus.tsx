import type { BeaconMonitoringEnvironment } from '@api/types';
import { Chip } from '@components/chip/Chip';
import { StatusDot } from '@components/statusDot/StatusDot';
import { BEACON_MONITORING_INTERVAL_LABELS } from '@constants/beaconMonitoring';
import { DEPLOYMENT_METADATA_ERROR_MESSAGES } from '@constants/deploymentMetadataErrors';
import { formatDateTime, formatTime } from '@utils/formatDate';

interface BeaconMonitoringStatusProps {
  monitoring: BeaconMonitoringEnvironment;
}

/** Lecture de la balise uniquement : « illisible » n'est pas une preuve de panne du site. */
export const BeaconMonitoringStatus = ({
  monitoring,
}: BeaconMonitoringStatusProps) => {
  const { status, interval, since, lastCheckedAt, error } = monitoring;
  const frequency = interval ? BEACON_MONITORING_INTERVAL_LABELS[interval] : '';

  if (status === 'pending') {
    return (
      <Chip icon={<StatusDot status="off" />}>
        En attente du premier contrôle
      </Chip>
    );
  }

  return (
    <span className="pp-environment-card-monitoring">
      <Chip
        variant={status === 'up' ? 'ok' : 'bad'}
        icon={<StatusDot status={status === 'up' ? 'ok' : 'bad'} />}
        title="Résultat de la lecture du fichier de la balise, pas de l'état complet du site"
      >
        {status === 'up'
          ? 'Balise lisible'
          : `Balise illisible${since ? ` depuis ${formatDateTime(since)}` : ''}`}
      </Chip>
      {lastCheckedAt && (
        <span className="pp-environment-card-none">
          Vérifiée à {formatTime(lastCheckedAt)}
          {frequency && ` · ${frequency}`}
        </span>
      )}
      {status === 'down' && error && (
        <span className="pp-environment-card-error" role="alert">
          {DEPLOYMENT_METADATA_ERROR_MESSAGES[error.code] ?? error.message}
        </span>
      )}
    </span>
  );
};
