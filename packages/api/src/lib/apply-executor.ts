/**
 * Executes a plan op against the daemon REST API.
 * Handles 409 idempotent creates and captures error detail up to 2 KB.
 */
import type { ControlaiInstance } from '@controlai-web/db';
import { callDaemon, DaemonError } from './daemon-client';
import type { Op, OpResult } from '@controlai-web/shared-types';

const RECONCILER_POLL_INTERVAL_MS = 5_000;
const RECONCILER_POLL_TIMEOUT_MS = 30_000;

export interface ExecuteOpOptions {
  /** Resolved tenantId from a prior createTenant op, if any. */
  tenantId?: string | null;
  /** Resolved siteId from a prior createSite op, if any. */
  siteId?: string | null;
}

/**
 * Replace path placeholders :tenantId / :siteId with resolved IDs.
 */
function resolvePath(
  path: string,
  opts: ExecuteOpOptions,
): string {
  let resolved = path;
  if (opts.tenantId) resolved = resolved.replace(':tenantId', opts.tenantId);
  if (opts.siteId) resolved = resolved.replace(':siteId', opts.siteId);
  return resolved;
}

/**
 * Execute a single op. Returns an OpResult with resolved IDs for subsequent ops.
 */
export async function executeOp(
  op: Op,
  instance: Pick<ControlaiInstance, 'baseURL' | 'bearerTokenEnc'>,
  opts: ExecuteOpOptions = {},
): Promise<{ result: OpResult; tenantId?: string; siteId?: string }> {
  const path = resolvePath(op.path, opts);

  try {
    const data = await callDaemon<Record<string, unknown>>(instance, path, {
      method: op.method,
      body: JSON.stringify(op.body),
    });

    let tenantId = opts.tenantId;
    let siteId = opts.siteId;

    if (op.type === 'createTenant' && typeof data?.id === 'string') {
      tenantId = data.id;
    }
    if (op.type === 'createSite' && typeof data?.id === 'string') {
      siteId = data.id;
    }

    return {
      result: {
        opId: op.id,
        type: op.type,
        status: 'success',
      },
      tenantId: tenantId ?? undefined,
      siteId: siteId ?? undefined,
    };
  } catch (err) {
    if (err instanceof DaemonError) {
      // 409 on create ops = idempotent success
      if (err.statusCode === 409 && (op.type === 'createTenant' || op.type === 'createSite')) {
        // Try to parse id from body for downstream ops
        let tenantId = opts.tenantId;
        let siteId = opts.siteId;
        try {
          const body = JSON.parse(err.body) as Record<string, unknown>;
          if (op.type === 'createTenant' && typeof body?.id === 'string') {
            tenantId = body.id;
          }
          if (op.type === 'createSite' && typeof body?.id === 'string') {
            siteId = body.id;
          }
        } catch {
          // ignore parse errors
        }
        return {
          result: {
            opId: op.id,
            type: op.type,
            status: 'success',
          },
          tenantId: tenantId ?? undefined,
          siteId: siteId ?? undefined,
        };
      }

      const truncated = err.body.slice(0, 2048);
      return {
        result: {
          opId: op.id,
          type: op.type,
          status: 'failed',
          errorDetail: truncated,
          daemonStatusCode: err.statusCode,
        },
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      result: {
        opId: op.id,
        type: op.type,
        status: 'failed',
        errorDetail: message.slice(0, 2048),
      },
    };
  }
}

/**
 * Poll the daemon /v1/status endpoint until reconciler converges or times out.
 * Returns true if healthy within timeout, false if timeout exceeded.
 */
export async function pollReconcilerStatus(
  instance: Pick<ControlaiInstance, 'baseURL' | 'bearerTokenEnc'>,
): Promise<boolean> {
  const deadline = Date.now() + RECONCILER_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const data = await callDaemon<{ status?: string }>(instance, '/v1/status', {
        method: 'GET',
        timeoutMs: 10_000,
      });
      if (data?.status === 'healthy' || data?.status === 'ok') {
        return true;
      }
    } catch {
      // ignore transient errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, RECONCILER_POLL_INTERVAL_MS));
  }

  return false;
}
