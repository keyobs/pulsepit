const commonVariables = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'USERPROFILE',
  'USERNAME',
  'HOMEDRIVE',
  'HOMEPATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'NO_COLOR',
  'CI',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'NODE_EXTRA_CA_CERTS',
] as const;

const gitVariables = [
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'SSH_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_SSH_VARIANT',
  'GIT_ASKPASS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_SSL_CAINFO',
  'GIT_SSL_CAPATH',
  'GCM_CREDENTIAL_STORE',
  'GCM_GUI_PROMPT',
  'GCM_PROVIDER',
] as const;

const packageVariables = [
  'COREPACK_HOME',
  'PNPM_HOME',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG',
  'NPM_CONFIG_REGISTRY',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'YARN_NPM_AUTH_TOKEN',
  'YARN_CACHE_FOLDER',
  'YARN_GLOBAL_FOLDER',
  'YARN_RC_FILENAME',
] as const;

export function createCommandEnvironment(
  purpose: 'git' | 'package-manager',
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set<string>([
    ...commonVariables,
    ...(purpose === 'git' ? gitVariables : packageVariables),
  ]);
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && allowed.has(name.toUpperCase()))
      environment[name] = value;
  }
  if (purpose === 'git') {
    environment.GIT_TERMINAL_PROMPT = '0';
    environment.GCM_INTERACTIVE = 'Never';
  }
  return environment;
}
