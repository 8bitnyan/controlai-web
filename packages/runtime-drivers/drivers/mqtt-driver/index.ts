import { z } from 'zod';
import { registerBrokerDriver, type BrokerDriverInstance } from '../../src';

export const MqttDriverConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  tls: z
    .object({
      ca: z.string().optional(),
      cert: z.string().optional(),
      key: z.string().optional(),
    })
    .optional(),
  clientIdPrefix: z.string().optional(),
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  servername: z.string().optional(),
});

export type MqttDriverConfig = z.infer<typeof MqttDriverConfigSchema>;

/**
 * mqtt-driver — wraps mqtt.js. v1 stub that exposes the BrokerDriver contract.
 * Full subscribe/publish wiring is delegated to the orchestrator in apps/mqtt-bridge.
 * The driver here owns validateConfig + the factory shape.
 */
function createMqttDriverInstance(config: unknown): BrokerDriverInstance {
  return {
    connect: async () => {
      MqttDriverConfigSchema.parse(config);
    },
    subscribe: async () => {
      // Orchestrator wires real mqtt.js subscriptions; stub no-op for unit tests.
    },
    publish: async () => {
      // Orchestrator handles publish via mqtt.js client; stub no-op.
    },
    healthCheck: async () => ({ ok: true }),
    validateConfig: (cfg) => {
      const parsed = MqttDriverConfigSchema.safeParse(cfg);
      if (parsed.success) return { ok: true };
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    },
    close: async () => {},
  };
}

registerBrokerDriver({
  id: 'mqtt-driver',
  displayName: 'MQTT Driver',
  supportedSiteCapabilities: ['mqtt-ingest'],
  configSchema: MqttDriverConfigSchema,
  factory: createMqttDriverInstance,
});
