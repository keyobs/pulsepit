import type { Repository } from '@api/types';

/** Dépôt valide selon le contrat, modifiable champ par champ. */
export function makeRepository(
  overrides: Partial<Repository> = {},
): Repository {
  return {
    name: 'mon-app',
    path: '/home/user/Projets/mon-app',
    git: {
      branch: 'develop',
      isClean: false,
      changedFiles: 4,
      untrackedFiles: 2,
    },
    gitError: null,
    sync: { upstream: 'origin/develop', ahead: 1, behind: 0 },
    developLastCommitAt: '2026-10-17T18:05:00.000Z',
    versions: {
      head: { version: '2.4.0', error: null },
      main: { version: '2.3.1', error: null },
      develop: { version: '2.4.0', error: null },
    },
    engines: null,
    enginesError: null,
    packageManager: { name: 'pnpm', source: 'lockfile', error: null },
    origin: {
      name: 'origin',
      url: 'https://github.com/keyobs/mon-app',
      github: {
        owner: 'keyobs',
        repo: 'mon-app',
        url: 'https://github.com/keyobs/mon-app',
      },
    },
    originError: null,
    urls: { production: 'https://app.domaine.fr' },
    hosting: { production: 'https://vercel.com/domaine/mon-app' },
    ...overrides,
  };
}

/** Réponse JSON d'un appel à fetch. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
