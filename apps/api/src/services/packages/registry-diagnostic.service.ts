import { stripVTControlCharacters } from 'node:util';
import type { RegistryDiagnosticCode } from '@pulsepit/contracts';

type Manager = 'npm' | 'pnpm' | 'yarn';
const messages: Record<RegistryDiagnosticCode, string> = {
  REGISTRY_DNS_FAILED:
    'A hostname used to reach the package registry could not be resolved. Check DNS, network, VPN and proxy configuration.',
  REGISTRY_CONNECTION_FAILED:
    'The connection used to reach the package registry failed. Check network, VPN, firewall and proxy configuration.',
  REGISTRY_TLS_FAILED:
    'The package registry certificate could not be verified. Check the certificate chain, trusted certificates, system clock and proxy configuration.',
  REGISTRY_REQUEST_TIMEOUT:
    'A request to the package registry timed out. Check connectivity and retry the diagnostic later.',
  REGISTRY_UNAVAILABLE:
    'A registry request returned a server error (HTTP 5xx). The registry or an intermediary may be unavailable. Retry the diagnostic later.',
  REGISTRY_CREDENTIALS_MISSING:
    'Package registry credentials are missing. Configure them in the API environment (.env) or package-manager configuration, then restart the API if .env changed.',
  REGISTRY_AUTHENTICATION_FAILED:
    'The package registry rejected authentication. Check registry credentials in the API environment (.env) and package-manager configuration, then restart the API if .env changed.',
  REGISTRY_ACCESS_DENIED:
    'The package registry denied access. Check registry credential permissions and access to the requested package.',
};
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const transportCodes: Record<string, RegistryDiagnosticCode> = {
  ENOTFOUND: 'REGISTRY_DNS_FAILED',
  EAI_AGAIN: 'REGISTRY_DNS_FAILED',
  ECONNREFUSED: 'REGISTRY_CONNECTION_FAILED',
  ECONNRESET: 'REGISTRY_CONNECTION_FAILED',
  ENETUNREACH: 'REGISTRY_CONNECTION_FAILED',
  EHOSTUNREACH: 'REGISTRY_CONNECTION_FAILED',
  ETIMEDOUT: 'REGISTRY_REQUEST_TIMEOUT',
  ESOCKETTIMEDOUT: 'REGISTRY_REQUEST_TIMEOUT',
  CERT_HAS_EXPIRED: 'REGISTRY_TLS_FAILED',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'REGISTRY_TLS_FAILED',
  SELF_SIGNED_CERT_IN_CHAIN: 'REGISTRY_TLS_FAILED',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'REGISTRY_TLS_FAILED',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'REGISTRY_TLS_FAILED',
  ERR_TLS_CERT_ALTNAME_INVALID: 'REGISTRY_TLS_FAILED',
};
function transportCode(code: unknown): RegistryDiagnosticCode | null {
  return typeof code === 'string' && Object.hasOwn(transportCodes, code)
    ? transportCodes[code]
    : null;
}
function transportError(message: string): RegistryDiagnosticCode | null {
  if (/^Hostname\/IP does not match certificate's altnames:/.test(message))
    return 'REGISTRY_TLS_FAILED';
  for (const fragment of message.split(/:\s+/)) {
    const part = fragment.trim();
    const match =
      /^(?:(?:getaddrinfo|connect|read|write|request)\s+)?([A-Z][A-Z0-9_]+)(?:\s|$)/.exec(
        part,
      );
    const code = transportCode(match?.[1]);
    if (code) return code;
    if (
      /^(?:self[- ]signed certificate(?: in certificate chain)?|certificate has expired|unable to verify the first certificate|unable to get local issuer certificate)[.!]?\s*$/i.test(
        part,
      )
    )
      return 'REGISTRY_TLS_FAILED';
  }
  return null;
}
function responseCode(
  status: string | undefined,
): RegistryDiagnosticCode | null {
  if (status === '401') return 'REGISTRY_AUTHENTICATION_FAILED';
  if (status === '403') return 'REGISTRY_ACCESS_DENIED';
  return status && /^5\d\d$/.test(status) ? 'REGISTRY_UNAVAILABLE' : null;
}
function packageError(
  manager: Manager,
  value: Record<string, unknown>,
): RegistryDiagnosticCode | null {
  const code = managerCode(manager, value.code);
  if (code) return code;
  if (
    manager === 'pnpm' &&
    ['ERR_PNPM_META_FETCH_FAIL', 'ERR_PNPM_FETCH_FAIL'].includes(
      String(value.code),
    )
  )
    return (
      (object(value.cause) ? transportCode(value.cause.code) : null) ??
      (typeof value.message === 'string' ? transportError(value.message) : null)
    );
  return null;
}
function managerCode(
  manager: Manager,
  code: unknown,
): RegistryDiagnosticCode | null {
  if (manager !== 'yarn') {
    const transport = transportCode(code);
    if (transport) return transport;
  }
  if (manager === 'npm') {
    if (typeof code === 'string' && /^E5\d\d$/.test(code))
      return 'REGISTRY_UNAVAILABLE';
    if (code === 'ENEEDAUTH') return 'REGISTRY_CREDENTIALS_MISSING';
    if (code === 'E401' || code === 'EOTP')
      return 'REGISTRY_AUTHENTICATION_FAILED';
    if (code === 'E403') return 'REGISTRY_ACCESS_DENIED';
  }
  if (manager === 'pnpm') {
    if (typeof code === 'string' && /^ERR_PNPM_FETCH_5\d\d$/.test(code))
      return 'REGISTRY_UNAVAILABLE';
    if (code === 'ERR_PNPM_FETCH_401') return 'REGISTRY_AUTHENTICATION_FAILED';
    if (code === 'ERR_PNPM_FETCH_403') return 'REGISTRY_ACCESS_DENIED';
  }
  if (manager === 'yarn') {
    if (code === 'YN0033' || code === 33) return 'REGISTRY_CREDENTIALS_MISSING';
    if (code === 'YN0041' || code === 41)
      return 'REGISTRY_AUTHENTICATION_FAILED';
  }
  return null;
}
function yarnError(message: string): RegistryDiagnosticCode | null {
  if (
    /\bFailed to replace env in config:\s*\$\{(?:NPM_TOKEN|NODE_AUTH_TOKEN|YARN_NPM_AUTH_TOKEN)\}/.test(
      message,
    ) ||
    /\bEnvironment variable not found \((?:NPM_TOKEN|NODE_AUTH_TOKEN|YARN_NPM_AUTH_TOKEN)\)/.test(
      message,
    )
  )
    return 'REGISTRY_CREDENTIALS_MISSING';
  const status =
    /\bRequest (?:failed(?: with status code)?|[^\r\n]+? failed with status code)[ :]+["']?(401|403|5\d\d)\b/i.exec(
      message,
    )?.[1];
  return responseCode(status) ?? transportError(message);
}
function yarnNetworkError(message: string): RegistryDiagnosticCode | null {
  const status = /^\s*Response Code:\s*(401|403|5\d\d)(?:\s|$)/.exec(
    message,
  )?.[1];
  return responseCode(status) ?? transportError(message);
}
function recordCode(
  manager: Manager,
  value: unknown,
): RegistryDiagnosticCode | null {
  if (!object(value)) return null;
  if (object(value.error)) return packageError(manager, value.error);
  if (manager !== 'yarn') return packageError(manager, value);
  if (value.type !== 'error') return null;
  if (
    (value.name === 35 || value.displayName === 'YN0035') &&
    typeof value.data === 'string'
  )
    return yarnNetworkError(value.data);
  return (
    managerCode(manager, value.name) ??
    managerCode(manager, value.displayName) ??
    (typeof value.data === 'string' ? yarnError(value.data) : null)
  );
}
function lineCode(
  manager: Manager,
  line: string,
): RegistryDiagnosticCode | null {
  if (manager === 'npm') {
    return managerCode(
      manager,
      /^\s*npm (?:ERR!|error) code ([A-Z][A-Z0-9_]*)\s*$/i
        .exec(line)?.[1]
        .toUpperCase(),
    );
  }
  if (manager === 'pnpm') {
    const match =
      /^\s*(?:\[([A-Z][A-Z0-9_]+)\]|([A-Z][A-Z0-9_]+))(?:\s|$)/.exec(line);
    const code = match?.[1] ?? match?.[2];
    if (code === 'ERR_PNPM_META_FETCH_FAIL' || code === 'ERR_PNPM_FETCH_FAIL')
      return transportError(line);
    return managerCode(manager, code);
  }
  const network = /^\s*(?:➤\s*)?YN0035:\s*(.*)$/.exec(line);
  if (network) return yarnNetworkError(network[1]);
  return (
    managerCode(
      manager,
      /^\s*(?:➤\s*)?(YN0033|YN0041):(?:\s|$)/.exec(line)?.[1],
    ) ?? yarnError(line)
  );
}
export function registryDiagnostic(
  manager: Manager,
  stdout: string,
  stderr: string,
  failed: boolean,
): { code: RegistryDiagnosticCode; error: string } | null {
  for (const output of [stdout, stderr]) {
    const plain = stripVTControlCharacters(output);
    let document: unknown;
    try {
      document = JSON.parse(plain);
    } catch {
      /* JSON lines or command text. */
    }
    let code = recordCode(manager, document);
    if (code) return { code, error: messages[code] };
    for (const line of plain.split(/\r?\n/)) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        /* Inspect known failure lines only. */
      }
      code =
        recordCode(manager, event) ?? (failed ? lineCode(manager, line) : null);
      if (code) return { code, error: messages[code] };
    }
  }
  return null;
}
