/**
 * HTTP client for the simulator service.
 * The web API proxies gateway control commands to the simulator over HTTP.
 */

const SIMULATOR_INTERNAL_URL =
  process.env.SIMULATOR_INTERNAL_URL ?? 'http://localhost:4001';

const SIMULATOR_API_TOKEN = process.env.SIMULATOR_API_TOKEN ?? '';

async function simFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${SIMULATOR_INTERNAL_URL.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(SIMULATOR_API_TOKEN ? { Authorization: `Bearer ${SIMULATOR_API_TOKEN}` } : {}),
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new SimulatorError(res.status, body, url);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function simStart(gatewayId: string): Promise<void> {
  await simFetch(`/gateways/${gatewayId}/start`, { method: 'POST' });
}

export async function simStop(gatewayId: string): Promise<void> {
  await simFetch(`/gateways/${gatewayId}/stop`, { method: 'POST' });
}

export async function simStatus(gatewayId: string): Promise<{ status: string; connected: boolean }> {
  return simFetch<{ status: string; connected: boolean }>(`/gateways/${gatewayId}/status`);
}

export class SimulatorError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`Simulator responded ${statusCode} at ${url}: ${body}`);
    this.name = 'SimulatorError';
  }
}
