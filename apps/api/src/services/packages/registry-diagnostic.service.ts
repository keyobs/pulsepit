import { stripVTControlCharacters } from 'node:util';
import type { RegistryDiagnosticCode } from '@pulsepit/contracts';

type Manager = 'npm' | 'pnpm' | 'yarn';
const messages: Record<RegistryDiagnosticCode, string> = {
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
function managerCode(
  manager: Manager,
  code: unknown,
): RegistryDiagnosticCode | null {
  if (manager === 'npm') {
    if (code === 'ENEEDAUTH') return 'REGISTRY_CREDENTIALS_MISSING';
    if (code === 'E401' || code === 'EOTP')
      return 'REGISTRY_AUTHENTICATION_FAILED';
    if (code === 'E403') return 'REGISTRY_ACCESS_DENIED';
  }
  if (manager === 'pnpm') {
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
    /\bRequest (?:failed(?: with status code)?|[^\r\n]+? failed with status code)[ :]+["']?(401|403)\b/i.exec(
      message,
    )?.[1];
  if (status === '401') return 'REGISTRY_AUTHENTICATION_FAILED';
  if (status === '403') return 'REGISTRY_ACCESS_DENIED';
  return null;
}
function yarnNetworkError(message: string): RegistryDiagnosticCode | null {
  const status = /^\s*Response Code:\s*(401|403)(?:\s|$)/.exec(message)?.[1];
  return status === '401'
    ? 'REGISTRY_AUTHENTICATION_FAILED'
    : status === '403'
      ? 'REGISTRY_ACCESS_DENIED'
      : null;
}
function recordCode(
  manager: Manager,
  value: unknown,
): RegistryDiagnosticCode | null {
  if (!object(value)) return null;
  if (object(value.error)) return managerCode(manager, value.error.code);
  if (manager !== 'yarn') return managerCode(manager, value.code);
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
      /^\s*npm (?:ERR!|error) code (E401|E403|EOTP|ENEEDAUTH)\s*$/i
        .exec(line)?.[1]
        .toUpperCase(),
    );
  }
  if (manager === 'pnpm') {
    const match =
      /^\s*(?:\[(ERR_PNPM_FETCH_(?:401|403))\]|(ERR_PNPM_FETCH_(?:401|403)))(?:\s|$)/.exec(
        line,
      );
    return managerCode(manager, match?.[1] ?? match?.[2]);
  }
  const network = /^\s*(?:➤\s*)?YN0035:\s*(Response Code:.*)$/.exec(line);
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
