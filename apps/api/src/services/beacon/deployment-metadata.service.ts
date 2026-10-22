import {
  DeploymentEnvironment,
  type DeploymentEnvironmentConfig,
  type DeploymentMetadataError,
} from '@pulsepit/contracts';
import type { StaticMetadataSource } from '../repositories/repository-config.service.js';

const maxBytes = 64 * 1024;
const observationSchema = DeploymentEnvironment.omit({ comparison: true });
export type DeploymentObservation = Omit<DeploymentEnvironment, 'comparison'>;
type MetadataErrorCode =
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'ENVIRONMENT_MISMATCH';

class MetadataError extends Error {
  constructor(
    readonly code: MetadataErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function invalid(
  message = 'The metadata source returned an invalid document.',
): never {
  throw new MetadataError('INVALID_RESPONSE', message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readDocument(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel();
    invalid('The metadata document exceeds 64 KiB.');
  }
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        invalid('The metadata document exceeds 64 KiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
}

function parseDocument(
  body: unknown,
  base: DeploymentObservation,
): DeploymentObservation {
  if (!isObject(body) || !Number.isInteger(body.protocolVersion)) invalid();
  if (body.protocolVersion !== 1) {
    throw new MetadataError(
      'UNSUPPORTED_PROTOCOL',
      'The beacon protocol version is not supported.',
    );
  }
  if (!isObject(body.app)) invalid();
  const app = body.app;
  for (const field of ['name', 'env']) {
    if (
      typeof app[field] !== 'string' ||
      !app[field].trim() ||
      app[field].length > 128
    )
      invalid();
  }
  if (
    app.version !== null &&
    (typeof app.version !== 'string' ||
      !app.version.trim() ||
      app.version.length > 128)
  )
    invalid();
  if (
    app.commit !== null &&
    (typeof app.commit !== 'string' ||
      !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(app.commit))
  )
    invalid();
  const parsed = observationSchema.safeParse({
    ...base,
    version: app.version,
    commit: app.commit,
    deployedAt: app.deployedAt,
    deploymentSource: app.deployedAt === null ? null : 'delivery',
  });
  if (!parsed.success) invalid();
  if (app.env !== base.environment) {
    throw new MetadataError(
      'ENVIRONMENT_MISMATCH',
      'The beacon environment does not match the configured environment.',
    );
  }
  return parsed.data;
}

async function collectEnvironment(
  environment: DeploymentEnvironmentConfig,
  source: StaticMetadataSource | undefined,
  timeoutMs: number,
): Promise<DeploymentObservation> {
  const base: DeploymentObservation = {
    ...environment,
    version: null,
    commit: null,
    deployedAt: null,
    deploymentSource: null,
    metadataCheckedAt: null,
    metadataError: null,
  };
  if (source === undefined) return base;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(source.url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MetadataError(
        'HTTP_ERROR',
        'The metadata source returned an unsuccessful HTTP status.',
      );
    }
    const body = await readDocument(response);
    if (signal.aborted) throw signal.reason;
    return {
      ...parseDocument(body, base),
      metadataCheckedAt: new Date().toISOString(),
    };
  } catch (error) {
    const metadataError: DeploymentMetadataError = signal.aborted
      ? { code: 'TIMEOUT', message: 'Reading deployment metadata timed out.' }
      : error instanceof MetadataError
        ? { code: error.code, message: error.message }
        : {
            code: 'NETWORK_ERROR',
            message:
              'Unable to read deployment metadata from the configured source.',
          };
    return {
      ...base,
      metadataCheckedAt: new Date().toISOString(),
      metadataError,
    };
  }
}

export async function collectDeploymentMetadata(
  environments: DeploymentEnvironmentConfig[],
  sources: Record<string, StaticMetadataSource>,
  timeoutMs = 5_000,
): Promise<DeploymentObservation[]> {
  const results: DeploymentObservation[] = new Array(environments.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, environments.length) }, async () => {
      while (next < environments.length) {
        const index = next++;
        const environment = environments[index];
        const source = Object.hasOwn(sources, environment.environment)
          ? sources[environment.environment]
          : undefined;
        results[index] = await collectEnvironment(
          environment,
          source,
          timeoutMs,
        );
      }
    }),
  );
  return results;
}
