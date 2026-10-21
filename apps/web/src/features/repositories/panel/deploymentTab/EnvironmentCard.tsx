import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { Card } from '@components/card/Card';
import { Chip } from '@components/chip/Chip';
import { LabeledCell } from '@components/labeledCell/LabeledCell';
import { LinkRow } from '@components/linkRow/LinkRow';
import { StatusDot } from '@components/statusDot/StatusDot';
import { useLinkFeedback } from '@hooks/useLinkFeedback';
import { hostLabel } from '@utils/hostLabel';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import './environmentCard.less';

interface EnvironmentCardProps {
  repository: Repository;
  environment: string;
}

/** Une carte par environnement : statut, latence, lien de l'app et lien vers la console de l'hébergeur. */
export const EnvironmentCard = ({
  repository,
  environment,
}: EnvironmentCardProps) => {
  const { deployments } = useRepositoryRuntime(repository.path);
  const feedback = useLinkFeedback();
  const check = deployments.state.data?.checks.find(
    (item) => item.environment === environment,
  );
  const url = repository.urls[environment];
  const hosting = repository.hosting[environment];
  const isChecking = deployments.state.status === 'loading';

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
  const label =
    check?.status === 'online'
      ? 'Online'
      : check?.status === 'offline'
        ? 'Offline'
        : 'Non vérifié';

  return (
    <Card
      title={<span className="pp-environment-card-name">{environment}</span>}
      tone={check?.status === 'offline' ? 'alert' : 'default'}
      actions={
        <>
          <Chip variant={variant} icon={<StatusDot status={dot} />}>
            {label}
            {check ? ` · ${check.responseTimeMs} ms` : ''}
          </Chip>
          <Button
            size="small"
            loading={isChecking}
            onClick={() => void deployments.run()}
          >
            Ping
          </Button>
        </>
      }
    >
      <LabeledCell label="URL">
        <LinkRow url={url} {...feedback} />
      </LabeledCell>
      {hosting ? (
        <LabeledCell label={`Hébergeur · ${hostLabel(hosting)}`}>
          <LinkRow url={hosting} {...feedback} />
        </LabeledCell>
      ) : (
        <LabeledCell label="Hébergeur">
          <span className="pp-environment-card-none">
            Pas de lien configuré
          </span>
        </LabeledCell>
      )}
      {check?.status === 'offline' && check.error && (
        <span className="pp-environment-card-error">{check.error}</span>
      )}
    </Card>
  );
};
