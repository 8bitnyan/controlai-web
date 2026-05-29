import { z } from 'zod';
import { registerBrokerDriver, type BrokerDriverInstance } from '../../src';

export const KafkaDriverConfigSchema = z.object({
  brokers: z.array(z.string()).min(1),
  saslMechanism: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
  saslUsername: z.string().optional(),
  saslPassword: z.string().optional(),
  groupId: z.string().min(1),
  topics: z.array(z.string()).min(1),
  jsonMapper: z.object({
    deviceKeyPath: z.string(),
    dataTypePath: z.string(),
    payloadPath: z.string(),
    tsPath: z.string().optional(),
  }),
});

export type KafkaDriverConfig = z.infer<typeof KafkaDriverConfigSchema>;

function createKafkaDriverInstance(config: unknown): BrokerDriverInstance {
  return {
    connect: async () => {
      KafkaDriverConfigSchema.parse(config);
    },
    subscribe: async () => {
      // Orchestrator owns kafkajs consumer wiring.
    },
    publish: async () => {
      throw new Error('kafka-driver does not support publish in v1');
    },
    healthCheck: async () => ({ ok: true }),
    validateConfig: (cfg) => {
      const parsed = KafkaDriverConfigSchema.safeParse(cfg);
      if (parsed.success) return { ok: true };
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    },
    close: async () => {},
  };
}

registerBrokerDriver({
  id: 'kafka-driver',
  displayName: 'Kafka Driver',
  supportedSiteCapabilities: ['kafka-ingest'],
  configSchema: KafkaDriverConfigSchema,
  factory: createKafkaDriverInstance,
});
