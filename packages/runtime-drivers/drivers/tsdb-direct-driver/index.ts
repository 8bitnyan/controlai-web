import { z } from 'zod';
import { registerBrokerDriver, type BrokerDriverInstance } from '../../src';
import type { NormalizedMessage } from '../../src/normalized-message';

export const TsdbDirectDriverConfigSchema = z.object({
  pgUrl: z.string().url(),
  batchSize: z.number().int().positive().default(500),
  idempotencyKey: z.enum(['deviceKey-ts-dataType', 'deviceKey-ts']).default('deviceKey-ts-dataType'),
});

export type TsdbDirectDriverConfig = z.infer<typeof TsdbDirectDriverConfigSchema>;

/**
 * tsdb-direct-driver — NOT a transport driver. The orchestrator calls writeDirect()
 * synchronously when Site.ingestModeJson opts into direct TSDB writes. subscribe()
 * and publish() throw sentinel errors so misconfiguration surfaces loudly.
 *
 * The actual hypertable insert lives in apps/tsdb-writer; this driver is a thin contract.
 */
function createTsdbDirectDriverInstance(config: unknown): BrokerDriverInstance & {
  writeDirect(messages: NormalizedMessage[]): Promise<void>;
} {
  return {
    connect: async () => {
      TsdbDirectDriverConfigSchema.parse(config);
    },
    subscribe: async () => {
      throw new Error(
        'tsdb-direct-driver is not a transport driver; invoke writeDirect() from the orchestrator',
      );
    },
    publish: async () => {
      throw new Error(
        'tsdb-direct-driver is not a transport driver; invoke writeDirect() from the orchestrator',
      );
    },
    writeDirect: async (_messages) => {
      // Real implementation in apps/tsdb-writer uses pg.Pool batchInsert; this driver is a shim.
    },
    healthCheck: async () => ({ ok: true }),
    validateConfig: (cfg) => {
      const parsed = TsdbDirectDriverConfigSchema.safeParse(cfg);
      if (parsed.success) return { ok: true };
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    },
    close: async () => {},
  };
}

registerBrokerDriver({
  id: 'tsdb-direct-driver',
  displayName: 'TSDB Direct Driver',
  supportedSiteCapabilities: ['tsdb-direct'],
  configSchema: TsdbDirectDriverConfigSchema,
  factory: createTsdbDirectDriverInstance,
});
