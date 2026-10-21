export interface BeaconAppMetadata {
  name: string;
  version: string | null;
  commit: string | null;
  env: string;
  deployedAt: string | null;
}

export interface BeaconManifest {
  protocolVersion: 1;
  app: BeaconAppMetadata;
}

export interface BeaconOptions {
  name: string;
  env: string;
  version?: string | null;
  commit?: string | null;
  deployedAt?: string | null;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new TypeError(
      `${field} must be a non-empty string of at most 128 characters.`,
    );
  }
  return value;
}

function commitSha(value: unknown): string | null {
  if (value == null) return null;
  if (
    typeof value !== 'string' ||
    !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value)
  ) {
    throw new TypeError(
      'commit must be a complete hexadecimal Git SHA or null.',
    );
  }
  return value.toLowerCase();
}

function deploymentDate(value: unknown): string | null {
  if (value == null) return null;
  const invalid = () =>
    new TypeError('deployedAt must be a valid UTC ISO datetime or null.');
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    throw invalid();
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw invalid();
  const normalized = value.includes('.')
    ? value.replace(
        /\.(\d{1,3})Z$/,
        (_match, fraction: string) => `.${fraction.padEnd(3, '0')}Z`,
      )
    : value.replace(/Z$/, '.000Z');
  // Reject invalid calendar dates that Date would silently move to the next month.
  if (timestamp.toISOString() !== normalized) throw invalid();
  return normalized;
}

/** Builds public metadata without accessing Git, the filesystem or the environment. */
export function createBeaconManifest(options: BeaconOptions): BeaconManifest {
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError('Beacon options must be an object.');
  }
  return {
    protocolVersion: 1,
    app: {
      name: text(options.name, 'name'),
      version:
        options.version == null ? null : text(options.version, 'version'),
      commit: commitSha(options.commit),
      env: text(options.env, 'env'),
      deployedAt: deploymentDate(options.deployedAt),
    },
  };
}
