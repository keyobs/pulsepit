import type {
  RescanFailure,
  RescanInterval,
  RescanState,
  Settings,
} from '@pulsepit/contracts';
import { findRepositories } from '../repositories/repositories.service.js';
import { fetchRepository, type GitFetchResult } from './git.service.js';

const intervals: Record<RescanInterval, number> = {
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
};
const concurrency = 4;

export class GitRescanService {
  private timer?: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  private delay: number | null = null;
  private closed = false;
  private state: RescanState = {
    lastStartedAt: null,
    lastFinishedAt: null,
    failures: [],
  };

  constructor(
    private readonly scanPaths: string[],
    private readonly fetch: (
      path: string,
    ) => Promise<GitFetchResult> = fetchRepository,
  ) {}

  configure(rescan: Settings['rescan']) {
    this.delay = rescan.enabled ? intervals[rescan.interval] : null;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) this.schedule();
  }

  snapshot(): RescanState {
    return { ...this.state, failures: [...this.state.failures] };
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    await this.running;
  }

  async run() {
    if (this.running) return this.running;
    this.running = this.cycle().finally(() => {
      this.running = null;
      this.schedule();
    });
    return this.running;
  }

  private schedule() {
    if (this.closed || this.delay === null || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, this.delay);
    this.timer.unref();
  }

  private async cycle() {
    this.state = { ...this.state, lastStartedAt: new Date().toISOString() };
    const failures: RescanFailure[] = [];
    try {
      const { repositories } = await findRepositories(this.scanPaths);
      const pending = repositories.map(({ path }) => path);
      const worker = async () => {
        for (let path = pending.shift(); path; path = pending.shift()) {
          if (this.closed) return;
          const result = await this.fetch(path);
          if (!result.success) failures.push({ path, code: result.code });
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      this.state = {
        ...this.state,
        lastFinishedAt: new Date().toISOString(),
        failures,
      };
    }
  }
}
