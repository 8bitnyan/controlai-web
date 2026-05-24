import { z } from 'zod';

// ─── Op types ─────────────────────────────────────────────────────────────────

export const OP_TYPES = [
  'createTenant',
  'createSite',
  'updateSite',
  'issueCert',
  'updateIngest',
  'updateTsdb',
] as const;

export type OpType = (typeof OP_TYPES)[number];

export const OpSchema = z.object({
  id: z.string(),
  type: z.enum(OP_TYPES),
  description: z.string(), // human-readable
  path: z.string(),        // daemon API path e.g. /v1/tenants
  method: z.enum(['POST', 'PATCH', 'PUT']),
  body: z.record(z.unknown()),
  nodeId: z.string().optional(), // canvas node this op originates from
});

export type Op = z.infer<typeof OpSchema>;

export const OpResultSchema = z.object({
  opId: z.string(),
  type: z.enum(OP_TYPES),
  status: z.enum(['pending', 'running', 'success', 'failed']),
  errorDetail: z.string().optional(), // daemon response body, up to 2 KB
  daemonStatusCode: z.number().optional(),
});

export type OpResult = z.infer<typeof OpResultSchema>;

export const PlanSchema = z.object({
  planId: z.string(),
  planHash: z.string(),
  ops: z.array(OpSchema),
});

export type Plan = z.infer<typeof PlanSchema>;

export const ApplyResultSchema = z.object({
  success: z.boolean(),
  ops: z.array(OpResultSchema),
  planHash: z.string(),
});

export type ApplyResult = z.infer<typeof ApplyResultSchema>;

// ─── Telemetry message from mqtt-bridge SSE ───────────────────────────────────

export const TelemetryMessageSchema = z.object({
  nodeId: z.string(),
  siteId: z.string(),
  topic: z.string().optional(),
  payload: z.unknown().optional(),
  status: z.enum(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE']).optional(),
  msgPerSec: z.number().optional(),
  timestamp: z.string(), // ISO
});

export type TelemetryMessage = z.infer<typeof TelemetryMessageSchema>;

// ─── Dashboard widget types ────────────────────────────────────────────────────

export const WIDGET_TYPES = ['msg-rate-chart', 'status-board', 'last-n-messages', 'capacity-gauge', 'sensor-io-stream'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WidgetConfigSchema = z.object({
  id: z.string(),
  type: z.enum(WIDGET_TYPES),
  title: z.string().optional(),
  config: z.record(z.unknown()).default({}),
});

export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;
