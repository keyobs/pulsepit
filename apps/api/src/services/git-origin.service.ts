import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface GithubRepositoryIdentity {
  owner: string;
  repo: string;
  url: string;
}

export interface OriginRemote {
  name: 'origin';
  url: string | null;
  github: GithubRepositoryIdentity | null;
}

export interface OriginResult {
  origin: OriginRemote | null;
  originError: string | null;
}

function githubIdentity(
  host: string,
  path: string,
): GithubRepositoryIdentity | null {
  if (host.toLowerCase() !== 'github.com') return null;
  const parts = path.replace(/^\//, '').replace(/\/$/, '').split('/');
  if (parts.length !== 2) return null;
  let owner: string;
  let repo: string;
  try {
    [owner, repo] = parts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  repo = repo.replace(/\.git$/, '');
  if (
    !/^[a-z0-9][a-z0-9-]*$/i.test(owner) ||
    !/^[a-z0-9_.-]+$/i.test(repo) ||
    repo === '.' ||
    repo === '..'
  )
    return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export function describeOrigin(raw: string): OriginRemote {
  const value = raw.trim();
  const result: OriginRemote = { name: 'origin', url: null, github: null };
  if (!value.includes('://') && !isAbsolute(value)) {
    const scp = /^(?:([^@\s/:]+)@)?([^/\s:]+):(.+)$/.exec(value);
    if (scp && (scp[1] === 'git' || scp[2].includes('.'))) {
      const [, user, host, rawPath] = scp;
      const path = rawPath.split(/[?#]/)[0];
      result.url = `${user === 'git' ? 'git@' : ''}${host}:${path}`;
      result.github = githubIdentity(host, path);
      return result;
    }
  }
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'ssh:', 'git:', 'file:'].includes(url.protocol))
      return result;
    if (url.protocol === 'ssh:') {
      if (!url.port || url.port === '22')
        result.github = githubIdentity(url.hostname, url.pathname);
    } else if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (!url.port) result.github = githubIdentity(url.hostname, url.pathname);
    }
    if (url.protocol !== 'ssh:' || url.username !== 'git') url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    result.url = url.href;
  } catch {
    if (isAbsolute(value) || value.startsWith('./') || value.startsWith('../'))
      result.url = value;
  }
  return result;
}

export async function getOriginRemote(
  repositoryPath: string,
): Promise<OriginResult> {
  try {
    // get-url resolves Git's insteadOf rules locally; it does not contact a remote.
    const { stdout } = await execute('git', ['remote', 'get-url', 'origin'], {
      cwd: repositoryPath,
      timeout: 5_000,
      killSignal: 'SIGKILL',
      maxBuffer: 128 * 1024,
      encoding: 'utf8',
    });
    return { origin: describeOrigin(stdout), originError: null };
  } catch (error) {
    const failure = error as { code?: number; signal?: string };
    if (failure.code === 2) return { origin: null, originError: null };
    return {
      origin: null,
      originError:
        failure.signal === 'SIGKILL'
          ? 'Reading origin timed out after 5 seconds.'
          : 'Unable to read origin for this repository.',
    };
  }
}
