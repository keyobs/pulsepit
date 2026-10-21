import type { Repository } from '@api/types';
import { cleanClasses } from '@utils/cleanClasses';
import { HiMiniSignal, HiMiniSignalSlash } from 'react-icons/hi2';
import './beaconIndicator.less';

interface BeaconIndicatorProps {
  beacon: Repository['beacon'];
  showWhenAbsent?: boolean;
}

const describe = ({
  package: declared,
  configuration,
  active,
}: Repository['beacon']) => {
  if (active) return 'Beacon actif : package déclaré et source configurée';
  if (!declared) return 'Beacon non détecté';
  if (configuration === 'invalid')
    return 'Beacon déclaré, configuration invalide';
  return 'Beacon déclaré, source non configurée';
};

export const BeaconIndicator = ({
  beacon,
  showWhenAbsent = false,
}: BeaconIndicatorProps) => {
  if (!beacon.package && !showWhenAbsent) return null;
  const label = describe(beacon);
  const Icon = beacon.package ? HiMiniSignal : HiMiniSignalSlash;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cleanClasses(
        'pp-beacon-indicator',
        beacon.active && 'active',
        !beacon.package && 'absent',
      )}
    >
      <Icon aria-hidden="true" />
    </span>
  );
};
