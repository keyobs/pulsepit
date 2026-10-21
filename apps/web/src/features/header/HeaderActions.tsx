import { Button } from '@components/button/Button';
import { FetchIcon } from '@components/icons/FetchIcon';
import { TbActivity, TbRefresh, TbStethoscope } from 'react-icons/tb';
import { useRepositoriesContext } from '../repositories/context/useRepositoriesContext';
import './headerActions.less';

/** Actions sur tous les dépôts, en grille de deux colonnes de même largeur. */
export const HeaderActions = () => {
  const { list, fetching, diagnostics, deployments } = useRepositoriesContext();
  const paths = list.repositories.map((repository) => repository.path);

  return (
    <div className="pp-header-actions">
      <Button
        icon={<TbRefresh />}
        loading={list.isLoading}
        onClick={() => void list.reload()}
      >
        Rescanner
      </Button>
      <Button
        icon={<TbActivity />}
        loading={deployments.isBusy}
        onClick={() => void deployments.runAll(paths)}
      >
        Vérifier les déploiements
      </Button>
      <Button
        icon={<FetchIcon />}
        loading={fetching.isBusy}
        onClick={() => void fetching.runAll(paths)}
      >
        Fetch All
      </Button>
      <Button
        variant="primary"
        icon={<TbStethoscope />}
        loading={diagnostics.isBusy}
        onClick={() => void diagnostics.runAll(paths)}
      >
        Lancer le diagnostic
      </Button>
    </div>
  );
};
