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

function clampDaemonBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  const json = JSON.stringify(body);
  if (json.length <= 2048) return body;
  return json.slice(0, 2048);
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

    if (op.type === 'createTenant') {
      const id = (data?.id ?? data?.ID) as string | undefined;
      if (typeof id === 'string') tenantId = id;
    }
    if (op.type === 'createSite') {
      const id = (data?.id ?? data?.ID) as string | undefined;
      if (typeof id === 'string') siteId = id;
      if (!siteId) {
        console.warn('[apply.executeOp] createSite succeeded but site id missing', {
          opId: op.id,
          path,
          body: data,
        });
      }
    }

    return {
      result: {
        opId: op.id,
        type: op.type,
        status: 'success',
        daemonResponseBody: clampDaemonBody(data),
      },
      tenantId: tenantId ?? undefined,
      siteId: siteId ?? undefined,
    };
  } catch (err) {
    if (err instanceof DaemonError) {
      // 409 on create ops = idempotent success
      if (err.statusCode === 409 && (op.type === 'createTenant' || op.type === 'createSite' || op.type === 'setBrokerKind' || op.type === 'setRetentionDays' || op.type === 'setIngestMode')) {
        // Try to parse id from body for downstream ops
        let tenantId = opts.tenantId;
        let siteId = opts.siteId;
        try {
          const body = JSON.parse(err.body) as Record<string, unknown>;
          if (op.type === 'createTenant') {
            const id = (body?.id ?? body?.ID) as string | undefined;
            if (typeof id === 'string') tenantId = id;
            // Fall back: daemon 409 error format → {"error":"tenant \"tnt_xxx\" already exists..."}
            if (!tenantId && typeof body?.error === 'string') {
              const m = body.error.match(/"(tnt_[A-Za-z0-9_.\-]+)"/);
              if (m) tenantId = m[1];
            }
          }
          if (op.type === 'createSite') {
            const id = (body?.id ?? body?.ID) as string | undefined;
            if (typeof id === 'string') siteId = id;
            // Fall back: daemon 409 error format → {"error":"site \"ste_xxx\" already exists..."}
            if (!siteId && typeof body?.error === 'string') {
              const m = body.error.match(/"(ste_[A-Za-z0-9_.\-]+)"/);
              if (m) siteId = m[1];
            }
          }
        } catch {
          // ignore parse errors
        }
        return {
          result: {
            opId: op.id,
            type: op.type,
            status: 'success',
            daemonResponseBody: err.body.slice(0, 2048),
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
