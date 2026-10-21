import { summarizeRepositories } from '@utils/repositorySummary';
import { useRepositoriesContext } from '../repositories/context/useRepositoriesContext';
import { SummaryStat } from './SummaryStat';
import './summaryBar.less';

const toneFor = (count: number | null, badTone: 'warn' | 'bad') =>
  count === null ? 'neutral' : count > 0 ? badTone : 'ok';

export const SummaryBar = () => {
  const { list, deployments, diagnostics } = useRepositoriesContext();
  const summary = summarizeRepositories(
    list.repositories,
    deployments.monitoringOf,
    (path) => diagnostics.stateOf(path).data,
  );

  return (
    <section className="pp-summary-bar" aria-label="Résumé">
      <SummaryStat value={summary.total} label="dépôts" />
      <SummaryStat
        value={summary.dirty}
        label="avec changements locaux"
        tone={toneFor(summary.dirty, 'warn')}
      />
      <SummaryStat
        value={summary.developAhead}
        label="develop en avance sur main"
        tone={toneFor(summary.developAhead, 'warn')}
      />
      <SummaryStat
        value={summary.offline}
        label="déploiement hors ligne"
        tone={toneFor(summary.offline, 'bad')}
      />
      <SummaryStat
        value={summary.outdated}
        label="avec dépendances obsolètes"
        tone={toneFor(summary.outdated, 'warn')}
      />
    </section>
  );
};
