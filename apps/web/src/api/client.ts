import { API_BASE, DEFAULT_REQUEST_TIMEOUT_MS } from '@constants/api';
import { ErrorResponse } from '@pulsepit/contracts';
import { ApiError, CLIENT_ERROR_CODES } from './apiError';

/** Tout schéma Zod du contrat convient : seul `parse` est utilisé. */
export interface Parser<T> {
  parse: (data: unknown) => T;
}

interface RequestOptions<T> {
  schema: Parser<T>;
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function buildUrl(path: string, query: RequestOptions<unknown>['query']) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_BASE}${path}${search ? `?${search}` : ''}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const parsed = ErrorResponse.safeParse(body);
  if (!parsed.success) {
    return new ApiError(`Erreur HTTP ${status}`, {
      status,
      code: `HTTP_${status}`,
    });
  }
  const { error, code, message, resetAt } = parsed.data;
  // La validation native de Fastify met le détail dans `message`, pas dans `error`.
  return new ApiError(message ?? error, {
    status,
    code: code ?? `HTTP_${status}`,
    resetAt,
  });
}

/** Appelle l'API, vérifie la réponse avec son schéma et convertit toute erreur en ApiError. */
export async function apiRequest<T>(
  path: string,
  {
    schema,
    method = 'GET',
    query,
    body,
    signal,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  }: RequestOptions<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers:
        body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new ApiError('Le serveur met trop de temps à répondre.', {
        status: 0,
        code: CLIENT_ERROR_CODES.timeout,
      });
    }
    throw new ApiError("Impossible de joindre l'API locale.", {
      status: 0,
      code: CLIENT_ERROR_CODES.network,
    });
  }

  const json = await readJson(response);
  if (!response.ok) throw toApiError(response.status, json);

  try {
    return schema.parse(json);
  } catch {
    throw new ApiError("La réponse de l'API ne respecte pas le contrat.", {
      status: response.status,
      code: CLIENT_ERROR_CODES.invalidResponse,
    });
  }
}
