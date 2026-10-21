import type { RepositorySync } from '@api/types';
import { Chip } from '@components/chip/Chip';

interface SyncChipProps {
  sync: RepositorySync;
}

/** Avance et retard de la branche courante sur son upstream, d'après le dernier fetch. */
export const SyncChip = ({ sync }: SyncChipProps) => {
  if (sync.upstream === null) {
    return (
      <Chip title="Aucun upstream configuré pour la branche courante">
        sans upstream
      </Chip>
    );
  }
  const title = `Par rapport à ${sync.upstream}, d'après le dernier fetch`;
  if (sync.ahead === null || sync.behind === null) {
    return <Chip title={title}>↑— ↓—</Chip>;
  }
  if (sync.ahead === 0 && sync.behind === 0) {
    return (
      <Chip variant="ok" title={title}>
        à jour
      </Chip>
    );
  }
  return (
    <Chip variant={sync.behind > 0 ? 'warn' : 'accent'} title={title}>
      ↑{sync.ahead} ↓{sync.behind}
    </Chip>
  );
};
