import type {
  DeploymentEnvironment,
  DeploymentEnvironmentConfig,
  Repository,
} from '@api/types';
import { Button } from '@components/button/Button';
import { Card } from '@components/card/Card';
import { Chip } from '@components/chip/Chip';
import { LabeledCell } from '@components/labeledCell/LabeledCell';
import { LinkRow } from '@components/linkRow/LinkRow';
import { StatusDot } from '@components/statusDot/StatusDot';
import { useLinkFeedback } from '@hooks/useLinkFeedback';
import { formatDateTime } from '@utils/formatDate';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import './environmentCard.less';

interface EnvironmentCardProps {
  repository: Repository;
  config: DeploymentEnvironmentConfig;
  /** Métadonnées de la dernière consultation ; `null` tant qu'elle n'a pas abouti. */
  metadata: DeploymentEnvironment | null;
}

const SOURCE_LABELS = {
  delivery: 'Fournie par la livraison',
  provider: "Observée chez l'hébergeur",
} as const;

/** Une carte par environnement : statut, branche, liens, date de déploiement et Ping de cet environnement. */
export const EnvironmentCard = ({
  repository,
  config,
  metadata,
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
      title={<span className="pp-environment-card-name">{label}</span>}
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
          {metadata.metadataError.message}
        </span>
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
