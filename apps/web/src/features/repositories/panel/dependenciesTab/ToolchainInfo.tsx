import type { Repository, ToolVersion } from '@api/types';
import { useBeaconVersion } from '@hooks/useBeaconVersion';
import { cleanClasses } from '@utils/cleanClasses';
import type { ReactNode } from 'react';
import { HiMiniSignal, HiMiniSignalSlash } from 'react-icons/hi2';
import { SiNodedotjs, SiNpm, SiPnpm, SiYarn } from 'react-icons/si';

const MANAGER_ICONS = {
  npm: <SiNpm color="#ca383a" />,
  pnpm: <SiPnpm color="#f69220" />,
  yarn: <SiYarn color="#2c8ebb" />,
};

const sourceOf = (tool: ToolVersion | null) =>
  tool
    ? `Déclaré dans ${tool.source}`
    : 'Aucune version déclarée dans le dépôt';

interface InfoProps {
  icon: ReactNode;
  label: string;
  title: string;
  muted?: boolean;
  children: ReactNode;
}

const Info = ({ icon, label, title, muted = false, children }: InfoProps) => (
  <span
    className={cleanClasses('pp-dependencies-tab-info', muted && 'muted')}
    title={title}
  >
    <span role="img" aria-label={label}>
      {icon}
    </span>
    {children}
  </span>
);

export const ToolchainInfo = ({ repository }: { repository: Repository }) => {
  const { toolchain, packageManager } = repository;
  const beacon = useBeaconVersion(repository.path, repository.beacon.package);
  return (
    <div className="pp-dependencies-tab-infos">
      {packageManager.name ? (
        <Info
          icon={MANAGER_ICONS[packageManager.name]}
          label={packageManager.name}
          title={`${packageManager.name} · ${sourceOf(toolchain.packageManager)}`}
        >
          {toolchain.packageManager?.version ?? '—'}
        </Info>
      ) : (
        <span className="pp-dependencies-tab-info muted">
          Gestionnaire non détecté
        </span>
      )}
      <Info
        icon={<SiNodedotjs color="#1ba673" />}
        label="Node.js"
        title={`Node.js · ${sourceOf(toolchain.node)}`}
      >
        {toolchain.node?.version ?? 'non précisé'}
      </Info>
      {repository.beacon.package ? (
        <Info icon={<HiMiniSignal />} label="Beacon" title="Beacon détecté">
          {beacon.isLoading ? '…' : (beacon.version ?? 'version inconnue')}
        </Info>
      ) : (
        <Info
          icon={<HiMiniSignalSlash />}
          label="Beacon"
          title="Beacon non détecté"
          muted
        >
          beacon
        </Info>
      )}
    </div>
  );
};
