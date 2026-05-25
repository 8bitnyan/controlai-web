/**
 * HTTP client for controlai daemon calls.
 * Decrypts the stored bearer token and makes authenticated fetch requests.
 */
import { decryptToken } from './crypto';
import type { ControlaiInstance } from '@controlai-web/db';

export interface DaemonHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version?: string;
  capacity?: {
    used_mb: number;
    allowed_mb: number;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/**
 * Make an authenticated request to a controlai daemon.
 */
export async function callDaemon<T>(
  instance: Pick<ControlaiInstance, 'baseURL' | 'bearerTokenEnc'>,
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const token = decryptToken(instance.bearerTokenEnc);
  const url = `${instance.baseURL.replace(/\/$/, '')}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(fetchOptions.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new DaemonError(response.status, body, url);
    }

    // Mutating endpoints (PATCH /sites/{id}, etc.) may legitimately return
    // 204 No Content or an empty body. Don't blow up trying to parse JSON.
    if (response.status === 204) return null as T;
    const text = await response.text();
    if (text.length === 0) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Body present but not JSON — surface a clearer error than "Unexpected
      // end of JSON input" so callers can debug.
      throw new DaemonError(
        response.status,
        `Non-JSON body (${text.length} bytes): ${text.slice(0, 200)}`,
        url,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Call the /v1/health endpoint with a 10 s timeout.
 * Used for both registration validation and health polling.
 */
export async function checkDaemonHealth(
  baseURL: string,
  bearerToken: string,
): Promise<DaemonHealthResponse> {
  const url = `${baseURL.replace(/\/$/, '')}/v1/health`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new DaemonError(response.status, body, url);
    }

    return (await response.json()) as DaemonHealthResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export class DaemonError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`Daemon responded ${statusCode} at ${url}: ${body}`);
    this.name = 'DaemonError';
  }
}
