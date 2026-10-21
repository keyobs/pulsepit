import { jsonResponse, makeRepository } from '@test/fixtures';
import {
  checkDeployments,
  fetchRepository,
  getBranches,
  getOrigin,
  getOutdated,
  getPackage,
  getWorkflows,
  listRepositories,
  pushBranch,
} from './repositories.api';

const PATH = '/home/user/Projets/mon-app';

describe('repositories api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const lastCall = () => ({
    url: fetchMock.mock.calls[0][0] as string,
    init: fetchMock.mock.calls[0][1] as RequestInit,
  });

  it('lists repositories', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        scanPaths: ['/home/user/Projets'],
        repositories: [makeRepository()],
        scanErrors: [],
      }),
    );
    const result = await listRepositories();
    expect(lastCall().url).toBe('/api/repositories');
    expect(result.repositories[0].name).toBe('mon-app');
    expect(result.scanPaths).toEqual(['/home/user/Projets']);
  });

  it('rejects a list that does not match the contract', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ repositories: [{ name: 'x' }] }),
    );
    await expect(listRepositories()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('fetches a repository', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ path: PATH, success: true }));
    await fetchRepository(PATH);
    expect(lastCall().url).toBe('/api/repositories/fetch');
    expect(lastCall().init.body).toBe(JSON.stringify({ path: PATH }));
  });

  it('pushes a branch', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        path: PATH,
        branch: 'develop',
        remote: 'origin',
        success: true,
      }),
    );
    const result = await pushBranch(PATH, 'develop');
    expect(lastCall().url).toBe('/api/repositories/push');
    expect(lastCall().init.body).toBe(
      JSON.stringify({ path: PATH, branch: 'develop' }),
    );
    expect(result.remote).toBe('origin');
  });

  it('lists local branches', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        path: PATH,
        branches: [{ name: 'main', isCurrent: true }],
      }),
    );
    const result = await getBranches(PATH);
    expect(lastCall().url).toBe(
      `/api/repositories/branches?path=${encodeURIComponent(PATH)}`,
    );
    expect(result.branches).toHaveLength(1);
  });

  it('runs the outdated diagnostic', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        path: PATH,
        packageManager: 'pnpm',
        dependencies: [],
        error: null,
      }),
    );
    const result = await getOutdated(PATH);
    expect(lastCall().url).toBe('/api/repositories/outdated');
    expect(result.dependencies).toEqual([]);
  });

  it('reads a package manifest, from HEAD by default', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ path: PATH, ref: 'head', manifest: { name: 'mon-app' } }),
    );
    await getPackage(PATH);
    expect(lastCall().url).toBe(
      `/api/repositories/package?path=${encodeURIComponent(PATH)}&ref=head`,
    );
  });

  it('checks deployments', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ path: PATH, configured: false, checks: [] }),
    );
    const result = await checkDeployments(PATH);
    expect(lastCall().url).toBe('/api/repositories/monitoring');
    expect(result.configured).toBe(false);
  });

  it('lists workflows', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        path: PATH,
        workflows: [{ provider: 'gitlab-ci', file: '.gitlab-ci.yml' }],
        errors: [],
      }),
    );
    const result = await getWorkflows(PATH);
    expect(lastCall().url).toBe(
      `/api/repositories/workflows?path=${encodeURIComponent(PATH)}`,
    );
    expect(result.workflows[0].provider).toBe('gitlab-ci');
  });

  it('reads the origin remote', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ path: PATH, origin: null, originError: null }),
    );
    const result = await getOrigin(PATH);
    expect(lastCall().url).toBe(
      `/api/repositories/origin?path=${encodeURIComponent(PATH)}`,
    );
    expect(result.origin).toBeNull();
  });
});
