import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { registerBrokerDriver, type BrokerDriverInstance } from '../../src';
import type { NormalizedMessage } from '../../src/normalized-message';

export const HttpWebhookDriverConfigSchema = z.object({
  secret: z.string().min(8),
  jsonMapper: z.object({
    deviceKeyPath: z.string(),
    dataTypePath: z.string(),
    payloadPath: z.string(),
    tsPath: z.string().optional(),
  }),
  requireHmac: z.boolean().default(true),
  allowedSkewSec: z.number().int().positive().default(300),
});

export type HttpWebhookDriverConfig = z.infer<typeof HttpWebhookDriverConfigSchema>;

export function verifyHmac(secret: string, body: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
}

function pathLookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export type WebhookHandleResult =
  | { ok: true; message: NormalizedMessage }
  | { ok: false; status: number; reason: string };

/**
 * Validates an incoming HTTP webhook payload and produces a NormalizedMessage.
 * The mqtt-bridge orchestrator mounts this handler under POST /ingest/:siteId.
 */
export function handleWebhook(
  config: HttpWebhookDriverConfig,
  args: { rawBody: string; headers: Record<string, string | undefined> },
): WebhookHandleResult {
  const signature = args.headers['x-controlai-signature'];
  const tsHeader = args.headers['x-controlai-timestamp'];

  if (config.requireHmac) {
    if (!signature) return { ok: false, status: 401, reason: 'missing X-Controlai-Signature' };
    if (!verifyHmac(config.secret, args.rawBody, signature)) {
      return { ok: false, status: 401, reason: 'invalid HMAC' };
    }
    if (tsHeader) {
      const ts = Number(tsHeader);
      const nowSec = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > config.allowedSkewSec) {
        return { ok: false, status: 401, reason: 'stale or invalid timestamp' };
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(args.rawBody);
  } catch {
    return { ok: false, status: 400, reason: 'malformed JSON' };
  }

  const deviceKey = pathLookup(parsed, config.jsonMapper.deviceKeyPath);
  const dataType = pathLookup(parsed, config.jsonMapper.dataTypePath);
  const payload = pathLookup(parsed, config.jsonMapper.payloadPath);
  const ts = config.jsonMapper.tsPath ? pathLookup(parsed, config.jsonMapper.tsPath) : undefined;

  if (typeof deviceKey !== 'string' || typeof dataType !== 'string') {
    return { ok: false, status: 400, reason: 'jsonMapper did not resolve deviceKey + dataType' };
  }

  return {
    ok: true,
    message: {
      deviceKey,
      dataType: dataType as NormalizedMessage['dataType'],
      payload,
      ts: typeof ts === 'string' ? ts : new Date().toISOString(),
      sourceDriver: 'http-webhook-driver',
    },
  };
}

function createHttpWebhookDriverInstance(config: unknown): BrokerDriverInstance {
  return {
    connect: async () => {
      HttpWebhookDriverConfigSchema.parse(config);
    },
    subscribe: async () => {
      // No transport subscribe — orchestrator mounts handleWebhook under POST /ingest/:siteId.
    },
    publish: async () => {
      throw new Error('http-webhook-driver does not support publish');
    },
    healthCheck: async () => ({ ok: true }),
    validateConfig: (cfg) => {
      const parsed = HttpWebhookDriverConfigSchema.safeParse(cfg);
      if (parsed.success) return { ok: true };
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    },
    close: async () => {},
  };
}

registerBrokerDriver({
  id: 'http-webhook-driver',
  displayName: 'HTTP Webhook Driver',
  supportedSiteCapabilities: ['http-webhook'],
  configSchema: HttpWebhookDriverConfigSchema,
  factory: createHttpWebhookDriverInstance,
});
