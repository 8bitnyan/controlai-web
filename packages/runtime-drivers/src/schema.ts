import { z } from 'zod';

/**
 * BrokerDriver schema — defines the registration contract for a runtime driver.
 * Mirrors the device-types registry pattern from spec 1.
 */

export const BrokerDriverIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const BrokerSupportedCapability = z.enum([
  'mqtt-ingest',
  'kafka-ingest',
  'http-webhook',
  'tsdb-direct',
]);
export type BrokerSupportedCapability = z.infer<typeof BrokerSupportedCapability>;

export interface BrokerDriverInstance {
  connect(): Promise<void>;
  subscribe(
    topics: string[],
    handler: (msg: import('./normalized-message').NormalizedMessage) => void,
  ): Promise<void>;
  publish(topic: string, payload: unknown): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; lastSeenAt?: Date; details?: Record<string, unknown> }>;
  validateConfig(config: unknown): { ok: boolean; errors?: string[] };
  close(): Promise<void>;
}

export const BrokerDriverSchema = z
  .object({
    id: BrokerDriverIdSchema,
    displayName: z.string().min(1),
    supportedSiteCapabilities: z.array(BrokerSupportedCapability).min(1),
    configSchema: z.custom<z.ZodTypeAny>(
      (val) => val !== null && typeof val === 'object' && typeof (val as { parse?: unknown }).parse === 'function',
      'configSchema must be a Zod schema',
    ),
    factory: z.custom<(config: unknown) => BrokerDriverInstance>(
      (val) => typeof val === 'function',
      'factory must be a function returning a BrokerDriverInstance',
    ),
  })
  .strict();

export type BrokerDriverDef = z.infer<typeof BrokerDriverSchema>;
