import type {
  BeaconMonitoringEnvironment,
  DeploymentEnvironment,
  DeploymentEnvironmentConfig,
  Repository,
} from '@api/types';
import { Button } from '@components/button/Button';
import { Card } from '@components/card/Card';
import { Chip } from '@components/chip/Chip';
import { CopyButton } from '@components/copyButton/CopyButton';
import { LabeledCell } from '@components/labeledCell/LabeledCell';
import { LinkRow } from '@components/linkRow/LinkRow';
import { StatusDot } from '@components/statusDot/StatusDot';
import { DEPLOYMENT_METADATA_ERROR_MESSAGES } from '@constants/deploymentMetadataErrors';
import { useLinkFeedback } from '@hooks/useLinkFeedback';
import { describeComparison } from '@utils/describeComparison';
import { formatDateTime } from '@utils/formatDate';
import { BeaconIndicator } from '../../beacon/BeaconIndicator';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import { BeaconMonitoringStatus } from './BeaconMonitoringStatus';
import './environmentCard.less';

interface EnvironmentCardProps {
  repository: Repository;
  config: DeploymentEnvironmentConfig;
  metadata: DeploymentEnvironment | null;
  monitoring?: BeaconMonitoringEnvironment;
}

const SOURCE_LABELS = {
  delivery: 'Fournie par la livraison',
  provider:
    "Observée chez l'hébergeur : première mise à disposition du déploiement en ligne. Une promotion ou un retour arrière conserve cette date.",
} as const;

export const EnvironmentCard = ({
  repository,
  config,
  metadata,
  monitoring,
}: EnvironmentCardProps) => {
  const { deployments } = useRepositoryRuntime(repository.path);
  const feedback = useLinkFeedback();
  const { environment, label, branch, url, hosting } = config;
  const check = deployments.monitoring?.checks.find(
    (item) => item.environment === environment,
  );
  const isChecking =
    deployments.pingStateOf(environment).status === 'loading' ||
    deployments.state.status === 'loading';

  const variant =
    check?.status === 'online'
      ? 'ok'
      : check?.status === 'offline'
        ? 'bad'
        : 'neutral';
  const dot =
    check?.status === 'online'
      ? 'ok'
      : check?.status === 'offline'
        ? 'bad'
        : 'off';
  const status =
    check?.status === 'online'
      ? 'En ligne'
      : check?.status === 'offline'
        ? 'Hors ligne'
        : 'Non vérifié';

  return (
    <Card
      title={
        <span className="pp-environment-card-name">
          {label}
          <BeaconIndicator beacon={repository.beacon} showWhenAbsent />
        </span>
      }
      tone={check?.status === 'offline' ? 'alert' : 'default'}
      actions={
        <>
          <Chip variant={variant} icon={<StatusDot status={dot} />}>
            {status}
            {check ? ` · ${check.responseTimeMs} ms` : ''}
          </Chip>
          <Button
            size="small"
            loading={isChecking}
            disabled={url === null}
            title={url === null ? 'URL non configurée' : undefined}
            onClick={() => void deployments.ping(environment)}
          >
            Ping
          </Button>
        </>
      }
    >
      <LabeledCell label="Branche">
        {branch ? (
          <span className="pp-environment-card-mono">{branch}</span>
        ) : (
          <span className="pp-environment-card-none">Non renseignée</span>
        )}
      </LabeledCell>
      <LabeledCell label="URL de l'application">
        {url ? (
          <LinkRow url={url} {...feedback} />
        ) : (
          <span className="pp-environment-card-none">URL non configurée</span>
        )}
      </LabeledCell>
      <LabeledCell
        label={hosting ? `Hébergeur · ${hosting.label}` : 'Hébergeur'}
      >
        {hosting?.url ? (
          <LinkRow url={hosting.url} {...feedback} />
        ) : (
          <span className="pp-environment-card-none">
            {hosting ? 'Pas de lien configuré' : 'Inconnu'}
          </span>
        )}
      </LabeledCell>
      <LabeledCell label="Version déployée">
        {metadata?.version ? (
          <span className="pp-environment-card-mono">{metadata.version}</span>
        ) : (
          <span className="pp-environment-card-none">Inconnue</span>
        )}
      </LabeledCell>
      <LabeledCell label="Commit déployé">
        {metadata?.commit ? (
          <span className="pp-environment-card-commit">
            <span className="pp-environment-card-mono" title={metadata.commit}>
              {metadata.commit.slice(0, 7)}
            </span>
            <CopyButton
              value={metadata.commit}
              label="Copier le commit"
              onCopied={feedback.onCopied}
              onError={feedback.onCopyError}
            />
          </span>
        ) : (
          <span className="pp-environment-card-none">Inconnu</span>
        )}
      </LabeledCell>
      {metadata && (
        <LabeledCell label="Écart avec la branche">
          <span
            title="Références locales, éventuellement périmées jusqu'au prochain fetch"
            className={
              metadata.comparison.status === 'unknown'
                ? 'pp-environment-card-none'
                : undefined
            }
          >
            {describeComparison(metadata.comparison)}
          </span>
        </LabeledCell>
      )}
      <LabeledCell label="Déployé le">
        {metadata?.deployedAt ? (
          <span
            title={
              metadata.deploymentSource
                ? SOURCE_LABELS[metadata.deploymentSource]
                : undefined
            }
          >
            {formatDateTime(metadata.deployedAt)}
          </span>
        ) : (
          <span className="pp-environment-card-none">Inconnu</span>
        )}
      </LabeledCell>
      {metadata?.metadataCheckedAt && (
        <LabeledCell label="Dernière consultation">
          {formatDateTime(metadata.metadataCheckedAt)}
        </LabeledCell>
      )}
      {metadata?.metadataError && (
        <span className="pp-environment-card-error" role="alert">
          Métadonnées indisponibles ({metadata.metadataError.code}) :{' '}
          {DEPLOYMENT_METADATA_ERROR_MESSAGES[metadata.metadataError.code] ??
            metadata.metadataError.message}
        </span>
      )}
      {monitoring && monitoring.status !== 'disabled' && (
        <LabeledCell label="Surveillance de la balise">
          <BeaconMonitoringStatus monitoring={monitoring} />
        </LabeledCell>
      )}
      {check && (
        <LabeledCell label="Dernière vérification">
          {formatDateTime(check.checkedAt)}
        </LabeledCell>
      )}
      {check?.status === 'offline' && check.error && (
        <span className="pp-environment-card-error">{check.error}</span>
      )}
    </Card>
  );
};
