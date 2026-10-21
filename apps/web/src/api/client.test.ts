import { jsonResponse } from '@test/fixtures';
import { ApiError } from './apiError';
import { apiRequest } from './client';

const schema = {
  parse: (data: unknown) => {
    if (typeof data === 'object' && data !== null && 'ok' in data)
      return data as { ok: boolean };
    throw new Error('invalid');
  },
};

describe('apiRequest', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('builds the url under /api with query parameters and skips undefined ones', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await apiRequest('/repositories/branches', {
      schema,
      query: { path: '/a b', ref: undefined },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/repositories/branches?path=%2Fa+b',
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('sends a JSON body on POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await apiRequest('/repositories/fetch', {
      schema,
      method: 'POST',
      body: { path: '/a' },
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.body).toBe('{"path":"/a"}');
  });

  it('returns the parsed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(apiRequest('/x', { schema })).resolves.toEqual({ ok: true });
  });

  it('turns an error response into an ApiError with its code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'Not a fast-forward', code: 'NON_FAST_FORWARD' },
        409,
      ),
    );
    const error = await apiRequest('/x', { schema }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'NON_FAST_FORWARD',
      message: 'Not a fast-forward',
    });
  });

  it('prefers message over error for Fastify validation errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          statusCode: 400,
          code: 'FST_ERR_VALIDATION',
          error: 'Bad Request',
          message: 'querystring must have required property path',
        },
        400,
      ),
    );
    const error = await apiRequest('/x', { schema }).catch((e) => e);
    expect(error.message).toBe('querystring must have required property path');
    expect(error.code).toBe('FST_ERR_VALIDATION');
  });

  it('keeps the rate limit reset date', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: 'rate limited',
          code: 'GITHUB_RATE_LIMITED',
          resetAt: '2026-10-20T14:32:00.000Z',
        },
        503,
      ),
    );
    const error = await apiRequest('/x', { schema }).catch((e) => e);
    expect(error.resetAt).toBe('2026-10-20T14:32:00.000Z');
  });

  it('falls back to an HTTP code when the error body is not usable', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>oops</html>', { status: 502 }),
    );
    const error = await apiRequest('/x', { schema }).catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('rejects a response that breaks the contract', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));
    const error = await apiRequest('/x', { schema }).catch((e) => e);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports an unreachable API', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const error = await apiRequest('/x', { schema }).catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('reports a client timeout', async () => {
    fetchMock.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'TimeoutError')),
          );
        }),
    );
    const error = await apiRequest('/x', { schema, timeoutMs: 10 }).catch(
      (e) => e,
    );
    expect(error).toMatchObject({ status: 0, code: 'CLIENT_TIMEOUT' });
  });

  it('rethrows the abort when the caller cancels', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = apiRequest('/x', {
      schema,
      signal: controller.signal,
    }).catch((e) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.name).toBe('AbortError');
  });
});
