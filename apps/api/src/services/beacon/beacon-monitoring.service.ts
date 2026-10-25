import type {
  BeaconMonitoringEnvironment,
  BeaconMonitoringInterval,
  BeaconMonitoringResponse,
} from '@pulsepit/contracts';
import { findConfiguredRepository } from '../repositories/repositories.service.js';
import type {
  ConfiguredDeploymentEnvironment,
  RepositoryConfigurationErrors,
  RepositoryEnvironments,
} from '../repositories/repository-config.service.js';
import { collectDeploymentMetadata } from './deployment-metadata.service.js';

const intervals: Record<BeaconMonitoringInterval, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
};
type Entry = {
  configuration: ConfiguredDeploymentEnvironment;
  state: BeaconMonitoringEnvironment;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};

export class BeaconMonitoringService {
  private entries: Entry[] = [];
  private active = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly scanPaths: string[],
    private readonly environments: RepositoryEnvironments,
    private readonly errors: RepositoryConfigurationErrors = {},
  ) {}

  async start() {
    for (const [path, environments] of Object.entries(this.environments)) {
      if (
        Object.hasOwn(this.errors, path) ||
        !(await findConfiguredRepository(path, this.scanPaths))
      )
        continue;
      for (const configuration of environments) {
        if (!configuration.metadata) continue;
        const settings = configuration.metadata.monitoring;
        const enabled = settings?.enabled === true;
        const entry: Entry = {
          configuration,
          controller: new AbortController(),
          state: {
            path,
            environment: configuration.environment,
            enabled,
            interval: enabled ? (settings?.interval ?? null) : null,
            status: enabled ? 'pending' : 'disabled',
            since: enabled ? new Date().toISOString() : null,
            lastCheckedAt: null,
            error: null,
          },
        };
        this.entries.push(entry);
      }
    }
    for (const entry of this.entries) {
      if (entry.state.enabled) this.launch(entry);
    }
  }

  private launch(entry: Entry) {
    if (this.stopped) return;
    const operation = this.check(entry).finally(() => {
      this.active.delete(operation);
      if (!this.stopped && entry.state.interval !== null) {
        entry.timer = setTimeout(
          () => this.launch(entry),
          intervals[entry.state.interval],
        );
        entry.timer.unref();
      }
    });
    this.active.add(operation);
  }

  private async check(entry: Entry) {
    try {
      const { path } = entry.state;
      if (
        !(await findConfiguredRepository(path, this.scanPaths)) ||
        this.stopped
      )
        return;
      const {
        metadata,
        deploymentDate: _date,
        ...environment
      } = entry.configuration;
      if (!metadata) return;
      const [observation] = await collectDeploymentMetadata(
        [environment],
        { [environment.environment]: metadata },
        5_000,
        entry.controller.signal,
      );
      if (this.stopped) return;
      const status = observation.metadataError === null ? 'up' : 'down';
      if (entry.state.status !== status)
        entry.state.since = observation.metadataCheckedAt;
      entry.state.status = status;
      entry.state.lastCheckedAt = observation.metadataCheckedAt;
      entry.state.error = observation.metadataError;
    } catch {
      // Shutdown can reject queued reads; never replan or publish an abort.
      if (this.stopped) return;
      const checkedAt = new Date().toISOString();
      if (entry.state.status !== 'down') entry.state.since = checkedAt;
      entry.state.status = 'down';
      entry.state.lastCheckedAt = checkedAt;
      entry.state.error = {
        code: 'NETWORK_ERROR',
        message:
          'Unable to read deployment metadata from the configured source.',
      };
    }
  }

  async snapshot(): Promise<BeaconMonitoringResponse> {
    const accessible = new Map<string, boolean>();
    for (const { state } of this.entries) {
      if (!accessible.has(state.path))
        accessible.set(
          state.path,
          (await findConfiguredRepository(state.path, this.scanPaths)) !== null,
        );
    }
    return {
      environments: this.entries
        .filter(({ state }) => accessible.get(state.path))
        .map(({ state }) => ({
          ...state,
          error: state.error ? { ...state.error } : null,
        })),
    };
  }

  async close() {
    this.stopped = true;
    for (const entry of this.entries) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.controller.abort();
    }
    await Promise.allSettled(this.active);
  }
}
