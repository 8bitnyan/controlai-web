import { z } from 'zod';
import { PortType } from './port-types';
import { ProtocolFamily } from './protocol-families';

export const Category = z.enum(['sensor', 'gateway', 'broker', 'ingest', 'tsdb', 'monitoring']);

export const DevicePortSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  direction: z.enum(['in', 'out', 'bidir']),
  portType: PortType,
  maxCount: z.number().int().positive(),
  acceptsProtocols: z.array(ProtocolFamily),
});

export const DefaultSignalSchema = z.object({
  rateMs: z.number().int().min(1),
  format: z.enum(['json', 'cbor', 'binary']),
  units: z.string(),
  range: z.object({ min: z.number(), max: z.number() }),
});

export const DeviceTypeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    displayName: z.string().min(1),
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    category: Category,
    firmwareTypeIds: z.array(z.string()).default([]),
    ports: z.array(DevicePortSchema).default([]),
    defaultSignal: DefaultSignalSchema.optional(),
    datasheet: z
      .object({
        firmwareVersion: z.string().optional(),
        datasheetUrl: z.string().url().optional(),
        certifications: z.array(z.string()).default([]),
      })
      .default({}),
    visual: z.object({
      iconRef: z.string().min(1),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      badge: z.string().optional(),
      componentRef: z.string().optional(),
    }),
    registrationHints: z
      .object({
        autoMatchSignature: z.string().optional(),
        expectedChildCount: z.number().int().nonnegative().optional(),
        expectedChildTypeIds: z.array(z.string()).default([]),
      })
      .default({}),
    constraints: z
      .object({
        maxSimulatedRateMs: z.number().int().min(100).optional(),
        minIntervalMs: z.number().int().min(1).default(100),
        maxPayloadBytes: z.number().int().positive().optional(),
      })
      .default({}),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    for (const port of m.ports) {
      if (seen.has(port.id)) {
        ctx.addIssue({ code: 'custom', path: ['ports'], message: `duplicate port id: ${port.id}` });
      }
      seen.add(port.id);
    }

    if (m.defaultSignal && m.defaultSignal.rateMs < m.constraints.minIntervalMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultSignal', 'rateMs'],
        message: 'defaultSignal.rateMs must be >= constraints.minIntervalMs',
      });
    }

    if (m.category === 'sensor') {
      if (!m.defaultSignal) ctx.addIssue({ code: 'custom', path: ['defaultSignal'], message: 'sensor requires defaultSignal' });
      if (m.ports.some((p) => p.direction !== 'out')) ctx.addIssue({ code: 'custom', path: ['ports'], message: 'sensor ports must be direction:out' });
    }

    if (m.category === 'broker') {
      const mqtt = m.ports.filter((p) => p.portType === 'mqtt-topic');
      if (mqtt.length !== 1) {
        ctx.addIssue({ code: 'custom', path: ['ports'], message: `broker requires exactly one mqtt-topic port, got ${mqtt.length}` });
      }
      if (m.defaultSignal) ctx.addIssue({ code: 'custom', path: ['defaultSignal'], message: 'broker forbids defaultSignal' });
    }

    if (m.category === 'gateway') {
      const hasRequiredPort = m.ports.some((p) => p.portType === 'rs485-bus' || p.portType === 'mqtt-topic');
      if (!hasRequiredPort) {
        ctx.addIssue({ code: 'custom', path: ['ports'], message: 'gateway requires at least one rs485-bus or mqtt-topic port' });
      }
    }

    if (m.category === 'ingest' || m.category === 'tsdb' || m.category === 'monitoring') {
      if (m.ports.length > 0) ctx.addIssue({ code: 'custom', path: ['ports'], message: `${m.category} forbids ports` });
      if (m.defaultSignal) ctx.addIssue({ code: 'custom', path: ['defaultSignal'], message: `${m.category} forbids defaultSignal` });
    }
  });

export type DeviceType = z.infer<typeof DeviceTypeSchema>;
