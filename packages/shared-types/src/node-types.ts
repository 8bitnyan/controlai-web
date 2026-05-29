import { z } from 'zod';

// ─── Node type literals ────────────────────────────────────────────────────────

/** @deprecated Use @controlai-web/shared-types device-types registry instead (getDeviceType, defaultNodeData(deviceTypeId)). */
export const NODE_TYPES = [
  'sensor',
  'gateway',
  'broker',
  'ingest',
  'timescaledb',
  'monitoring',
] as const;

/** @deprecated Use @controlai-web/shared-types device-types registry instead (getDeviceType, defaultNodeData(deviceTypeId)). */
export type NodeType = (typeof NODE_TYPES)[number];

// ─── Per-node data schemas ─────────────────────────────────────────────────────

export const SensorDataSchema = z.object({
  type: z.literal('sensor'),
  label: z.string().default('Sensor'),
  device_id: z.string().default(''),
  topic_prefix: z.string().default('sensors/'),
  qos: z.enum(['0', '1', '2']).default('1'),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).default('UNKNOWN'),
  msgPerSec: z.number().default(0),
});

export const GatewayDataSchema = z.object({
  type: z.literal('gateway'),
  label: z.string().default('Gateway'),
  gateway_id: z.string().default(''),
  protocol: z.enum(['mqtt', 'coap', 'http']).default('mqtt'),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).default('UNKNOWN'),
  msgPerSec: z.number().default(0),
});

export const BrokerDataSchema = z.object({
  type: z.literal('broker'),
  label: z.string().default('Broker'),
  kind: z.enum(['mosquitto', 'emqx']).default('mosquitto'),
  throughput: z.enum(['low', 'mid']).default('low'),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).default('UNKNOWN'),
  msgPerSec: z.number().default(0),
});

export const IngestDataSchema = z.object({
  type: z.literal('ingest'),
  label: z.string().default('Ingest'),
  direction: z.enum(['uni', 'bi']).default('uni'),
  batch_size: z.number().int().min(1).max(10000).default(100),
  max_throughput_per_sec: z.number().int().min(1).max(100000).default(1000),
  drop_policy: z.enum(['drop-newest', 'drop-oldest', 'backpressure']).default('drop-newest'),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).default('UNKNOWN'),
  msgPerSec: z.number().default(0),
});

export const TimescaleDBDataSchema = z.object({
  type: z.literal('timescaledb'),
  label: z.string().default('TimescaleDB'),
  retention: z.enum(['1m', '1h', '1d', '7d', '30d', '90d', '180d', '365d']).default('7d'),
  max_size_gb: z.number().int().min(1).max(10000).default(10),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).default('UNKNOWN'),
  msgPerSec: z.number().default(0),
});

export const MonitoringDataSchema = z.object({
  type: z.literal('monitoring'),
  label: z.string().default('Monitoring'),
  metrics: z.array(z.enum(['msg_rate', 'lag', 'error_rate'])).default(['msg_rate']),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).default('UNKNOWN'),
  msgPerSec: z.number().default(0),
});

export const NodeDataSchema = z.discriminatedUnion('type', [
  SensorDataSchema,
  GatewayDataSchema,
  BrokerDataSchema,
  IngestDataSchema,
  TimescaleDBDataSchema,
  MonitoringDataSchema,
]);

export type SensorData = z.infer<typeof SensorDataSchema>;
export type GatewayData = z.infer<typeof GatewayDataSchema>;
export type BrokerData = z.infer<typeof BrokerDataSchema>;
export type IngestData = z.infer<typeof IngestDataSchema>;
export type TimescaleDBData = z.infer<typeof TimescaleDBDataSchema>;
export type MonitoringData = z.infer<typeof MonitoringDataSchema>;
export type NodeData = z.infer<typeof NodeDataSchema>;

export type NodeStatus = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE';

// ─── Default node data factory ─────────────────────────────────────────────────

let __warned = false;

/** @deprecated Use @controlai-web/shared-types device-types registry instead (getDeviceType, defaultNodeData(deviceTypeId)). */
export function defaultNodeData(type: NodeType): NodeData {
  if (!__warned && typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn('[shared-types] defaultNodeData(NodeType) is deprecated; use defaultNodeData(deviceTypeId) from device-types.');
    __warned = true;
  }

  switch (type) {
    case 'sensor':
      return SensorDataSchema.parse({ type });
    case 'gateway':
      return GatewayDataSchema.parse({ type });
    case 'broker':
      return BrokerDataSchema.parse({ type });
    case 'ingest':
      return IngestDataSchema.parse({ type });
    case 'timescaledb':
      return TimescaleDBDataSchema.parse({ type });
    case 'monitoring':
      return MonitoringDataSchema.parse({ type });
  }
}
