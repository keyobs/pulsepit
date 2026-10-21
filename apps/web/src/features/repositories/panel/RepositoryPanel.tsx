import type { Repository } from '@api/types';
import { PlaceholderBox } from '@components/placeholderBox/PlaceholderBox';
import { Tabs } from '@components/tabs/Tabs';
import { PANEL_TABS, type PanelTabId } from '@constants/panelTabs';
import { useState } from 'react';
import { DependenciesTab } from './dependenciesTab/DependenciesTab';
import { DeploymentTab } from './deploymentTab/DeploymentTab';
import { GitTab } from './gitTab/GitTab';
import './repositoryPanel.less';

interface RepositoryPanelProps {
  repository: Repository;
}

const TAB_CONTENT: Record<
  PanelTabId,
  (repository: Repository) => React.ReactNode
> = {
  git: (repository) => <GitTab repository={repository} />,
  dependencies: (repository) => <DependenciesTab repository={repository} />,
  deployment: (repository) => <DeploymentTab repository={repository} />,
  errors: () => (
    <PlaceholderBox title="Monitoring des erreurs" badge="v2">
      Erreurs applicatives des apps déployées : volume, dernières occurrences,
      évolution. Source prévue : la balise (spec 3.8).
    </PlaceholderBox>
  ),
  resources: () => (
    <PlaceholderBox title="Monitoring des ressources" badge="v2">
      CPU, mémoire, stockage et bande passante par environnement. Source prévue
      : la balise (spec 3.8).
    </PlaceholderBox>
  ),
};

export const RepositoryPanel = ({ repository }: RepositoryPanelProps) => {
  const [activeTab, setActiveTab] = useState<PanelTabId>('git');
  return (
    <div className="pp-repository-panel">
      <Tabs
        items={PANEL_TABS}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel={`Détails de ${repository.name}`}
      />
      <div className="pp-repository-panel-content" role="tabpanel">
        {TAB_CONTENT[activeTab](repository)}
      </div>
    </div>
  );
};
