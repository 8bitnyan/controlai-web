import { EventEmitter } from 'events';
import mqtt, { type MqttClient } from 'mqtt';
import pino from 'pino';
import { prisma } from '@controlai-web/db';
import { Counter } from 'prom-client';
import { TokenBucket } from '@controlai-web/shared-types';
import { decryptToken } from './crypto.js';
import type { GatewayDTO, InboundEvent, SensorConfig } from './types.js';
import { getDeviceType } from '@controlai-web/shared-types';
import { topicFor, encodeNbirth, encodeNdata, encodeNdeath } from './cbor-codec.js';
import { decode } from 'cbor-x';
import { createGenerator, type RuntimeGenerator } from './generators/index.js';

const SENSOR_TYPES = new Set(['temperature', 'pressure', 'humidity', 'vibration']);
const PATTERNS = new Set(['tilt', 'vibration', 'crack-encoder', 'noise-meter', 'vibrating-wire', 'random-walk', 'random', 'sine']);
function isSensorType(value: unknown): value is SensorConfig['type'] {
  return typeof value === 'string' && SENSOR_TYPES.has(value);
}
function isPattern(value: unknown): value is NonNullable<SensorConfig['pattern']> {
  return typeof value === 'string' && PATTERNS.has(value);
}

export const logger = pino({ name: 'simulator-manager' });
const reconcileMs = Number(process.env.SIM_RECONCILE_MS ?? '5000');
const rateCap = Number(process.env.SIM_RATE_CAP ?? '1000');
const tlsInsecure = process.env.SIM_TLS_INSECURE === 'true';
const buckets = new Map<string, TokenBucket>();
const siteGroupLoops = new Map<string, ReturnType<typeof setInterval>>();
const simRateCapDelays = new Counter({
  name: 'sim_rate_cap_delays_total',
  help: 'Count of simulator publish delay events caused by rate cap',
  labelNames: ['siteGroupId'],
});

export interface GatewayStatusEvent {
  gatewayId: string;
  status: string;
  error?: string;
}

export interface GatewayOutboxEvent {
  gatewayId: string;
  topic: string;
  payloadSummary: string;
  ts: number;
  readings?: Array<{ sensorId: string; value: number }>;
}

interface GatewayRuntime {
  client: MqttClient;
  intervals: ReturnType<typeof setInterval>[];
  generators: Map<string, RuntimeGenerator>;
  gatewayId: string;
  siteGroupId: string;
}

export const simulatorEvents = new EventEmitter();
simulatorEvents.setMaxListeners(200);

if (tlsInsecure) {
  logger.warn('SIM_TLS_INSECURE=true (DEV ONLY): TLS hostname/certificate verification is disabled for MQTT connections');
}

/** Map<gatewayId, GatewayRuntime> */
const runtimes = new Map<string, GatewayRuntime>();

function getBucket(siteGroupId: string): TokenBucket {
  const existing = buckets.get(siteGroupId);
  if (existing) return existing;
  const next = new TokenBucket({ capacity: rateCap, refillPerSec: rateCap });
  buckets.set(siteGroupId, next);
  return next;
}

export function resolveSensorRuntime(sensor: SensorConfig): SensorConfig {
  const manifest = (sensor.deviceTypeId ? getDeviceType(sensor.deviceTypeId) : null) ?? getDeviceType('core-generic-sensor');
  if (!manifest) {
    throw new Error('Missing required core-generic-sensor device manifest');
  }

  const intervalMs = Math.max(sensor.intervalMs ?? manifest.defaultSignal?.rateMs ?? 1000, manifest.constraints.minIntervalMs ?? 100);

  return {
    ...sensor,
    intervalMs,
    deviceTypeId: manifest.id,
  };
}

function emitStatus(gatewayId: string, status: string, error?: string): void {
  const evt: GatewayStatusEvent = { gatewayId, status, error };
  simulatorEvents.emit('gatewayStatus', evt);
  simulatorEvents.emit(`gatewayStatus:${gatewayId}`, evt);
}

function emitOutbox(evt: GatewayOutboxEvent): void {
  simulatorEvents.emit('gatewayOutbox', evt);
  simulatorEvents.emit(`gatewayOutbox:${evt.gatewayId}`, evt);
}

export function parseInboundEvent(params: { topic: string; payload: Buffer; siteGroupId: string; gatewayClientId: string }): InboundEvent | null {
  const parts = params.topic.split('/');
  if (parts.length < 4 || parts[0] !== 'modules') return null;
  const msgType = parts[2] ?? '';
  const clientId = parts[3] ?? '';
  if (!msgType || !clientId) return null;
  const ts = Date.now();
  let readings: Array<{ sensorId: string; value: number; ts: number }> | undefined;
  let payloadSummary = msgType;
  try {
    const decoded = decode(params.payload) as Record<string, unknown>;
    const rawReadings = Array.isArray(decoded?.readings) ? decoded.readings : [];
    if (msgType === 'NDATA') {
      readings = rawReadings.map((item) => {
        const row = item as Record<string, unknown>;
        const sensorId = typeof row.sensorId === 'string' ? row.sensorId : null;
        const value = typeof row.value === 'number' ? row.value : null;
        const readingTs = typeof row.ts === 'number' ? row.ts : ts;
        return sensorId && value !== null ? { sensorId, value, ts: readingTs } : null;
      }).filter((v): v is { sensorId: string; value: number; ts: number } => v !== null);
      const head = readings.slice(0, 4).map((r) => `${r.sensorId}=${r.value.toFixed(3)}`).join(', ');
      payloadSummary = `NDATA ${readings.length} readings${head ? `: ${head}` : ''}`.slice(0, 200);
    } else if (msgType === 'NBIRTH') payloadSummary = `NBIRTH ${rawReadings.length} sensors`;
    else if (msgType === 'NDEATH') payloadSummary = 'NDEATH';
  } catch {
    payloadSummary = `${msgType} (decode failed)`;
  }
  return { siteGroupId: params.siteGroupId, topic: params.topic, msgType, clientId, ts, payloadSummary, readings, source: clientId === params.gatewayClientId ? 'sim' : 'board' };
}

async function loadGateway(gatewayId: string): Promise<GatewayDTO & {
  rootCaPemEnc: string;
  clientCertPemEnc: string;
  clientKeyPemEnc: string;
}> {
  const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gatewayId } });
  return {
    id: row.id,
    canvasNodeId: row.canvasNodeId,
    siteGroupId: row.siteGroupId,
    label: row.label,
    kind: row.kind as GatewayDTO['kind'],
    mode: row.mode as GatewayDTO['mode'],
    endpointURL: row.endpointURL,
    tlsServername: row.tlsServername,
    brokerHost: row.brokerHost,
    brokerPort: row.brokerPort,
    groupId: row.groupId,
    clientId: row.clientId,
    hasCerts: Boolean(row.rootCaPemEnc && row.clientCertPemEnc && row.clientKeyPemEnc),
    sensors: row.sensors as unknown as SensorConfig[],
    jsonTopicTemplate: row.jsonTopicTemplate,
    desiredState: row.desiredState as GatewayDTO['desiredState'],
    lastStatus: row.lastStatus as GatewayDTO['lastStatus'],
    lastError: row.lastError,
    rootCaPemEnc: row.rootCaPemEnc,
    clientCertPemEnc: row.clientCertPemEnc,
    clientKeyPemEnc: row.clientKeyPemEnc,
  };
}

async function updateStatus(gatewayId: string, status: string, error?: string | null): Promise<void> {
  await prisma.gateway.update({
    where: { id: gatewayId },
    data: { lastStatus: status, lastError: error ?? null },
  });
}

export async function startGateway(gatewayId: string, sensorsOverride?: SensorConfig[]): Promise<void> {
  if (runtimes.has(gatewayId)) {
    logger.info({ gatewayId }, 'Gateway already running');
    return;
  }

  const gw = await loadGateway(gatewayId);
  const rootCaPem = decryptToken(gw.rootCaPemEnc);
  const clientCertPem = decryptToken(gw.clientCertPemEnc);
  const clientKeyPem = decryptToken(gw.clientKeyPemEnc);

  const sensors = (sensorsOverride ?? (gw.sensors as SensorConfig[])).map((sensor) => resolveSensorRuntime(sensor));

  // Build LWT for cbor mode
  const ndeath = gw.mode === 'cbor-modules-cloud' ? encodeNdeath(gw) : null;
  const deathTopic = gw.mode === 'cbor-modules-cloud' ? topicFor(gw, 'NDEATH') : null;

  emitStatus(gatewayId, 'connecting');
  await updateStatus(gatewayId, 'connecting');

  const endpoint = new URL(gw.endpointURL);
  const tcpHost = gw.brokerHost ?? endpoint.hostname;
  const tcpPort = gw.brokerPort ?? (endpoint.port ? Number(endpoint.port) : 8883);
  const servername = gw.tlsServername ?? endpoint.hostname;
  const connectUrl = `mqtts://${tcpHost}:${tcpPort}`;

  // Custom cert-identity check: validate cert SAN against the SNI hostname we sent,
  // not against the TCP connect host (which is an IP or routing FQDN that won't be in the SAN).
  const { checkServerIdentity: defaultCheck } = await import('node:tls');
  const checkServerIdentity = (_host: string, cert: import('node:tls').PeerCertificate) =>
    defaultCheck(servername, cert);

  const client = mqtt.connect(connectUrl, {
    clientId: gw.clientId,
    clean: true,
    reconnectPeriod: 5000,
    ca: rootCaPem,
    cert: clientCertPem,
    key: clientKeyPem,
    rejectUnauthorized: !tlsInsecure,
    servername,
    // mqtt.js IClientOptions doesn't declare checkServerIdentity, but it forwards
    // unknown TLS options to tls.connect. Cast through unknown to bypass the lint.
    ...({ checkServerIdentity } as unknown as Record<string, unknown>),
    ...(ndeath && deathTopic
      ? {
          will: {
            topic: deathTopic,
            payload: ndeath,
            qos: 1,
            retain: false,
          },
        }
      : {}),
  });

  const generators = new Map<string, RuntimeGenerator>();
  for (const sensor of sensors) {
    generators.set(sensor.id, createGenerator(sensor));
  }

  const intervals: ReturnType<typeof setInterval>[] = [];
  const runtime: GatewayRuntime = { client, intervals, generators, gatewayId, siteGroupId: gw.siteGroupId };
  runtimes.set(gatewayId, runtime);

  client.on('connect', () => {
    logger.info({ gatewayId }, 'Gateway connected');
    emitStatus(gatewayId, 'connected');
    void updateStatus(gatewayId, 'connected');

    // Publish NBIRTH for cbor mode
    if (gw.mode === 'cbor-modules-cloud') {
      const nbirth = encodeNbirth(gw, sensors);
      const topic = topicFor(gw, 'NBIRTH');
      client.publish(topic, nbirth, { qos: 1 }, (err) => {
        if (err) logger.error({ gatewayId, err }, 'NBIRTH publish error');
      });
      emitOutbox({
        gatewayId,
        topic,
        payloadSummary: `NBIRTH ${sensors.length} sensors [${sensors.map((s) => s.id).join(',')}]`,
        ts: Date.now(),
      });

      const inboundTopic = `modules/${gw.groupId}/+/+`;
      client.subscribe(inboundTopic, { qos: 0 }, (err) => {
        if (err) logger.warn({ gatewayId, err: err.message }, 'broker inbound subscribe failed');
        else logger.info({ gatewayId, inboundTopic }, 'broker inbound subscribed');
      });
    }

    // Start per-sensor publish intervals
    for (const sensor of sensors) {
      const gen = generators.get(sensor.id)!;
      const interval = setInterval(() => {
        void (async () => {
        if (!client.connected) return;
        const value = gen.next();
        const ts = Date.now();
        const startTs = Date.now();
        await getBucket(gw.siteGroupId).acquire();
        if (Date.now() - startTs > 0) {
          simRateCapDelays.inc({ siteGroupId: gw.siteGroupId });
        }

        if (gw.mode === 'cbor-modules-cloud') {
          const values = Array.isArray(value) ? value : [value];
          const readings = values.map((v, idx) => ({ sensorId: values.length > 1 ? `${sensor.id}-${idx + 1}` : sensor.id, value: v, ts }));
          const payload = encodeNdata(gw, readings);
          const topic = topicFor(gw, 'NDATA');
          client.publish(topic, payload, { qos: 0 });
          emitOutbox({
            gatewayId,
            topic,
             payloadSummary: `NDATA ${sensor.id}=${values.map((v) => v.toFixed(3)).join(',')}`,
             ts,
             readings: readings.map((r) => ({ sensorId: r.sensorId, value: r.value })),
           });
         } else {
          // json mode
          const template = gw.jsonTopicTemplate ?? `gateways/${gw.clientId}/sensors/${sensor.id}`;
          const topic = template
            .replace('{siteId}', gw.groupId)
            .replace('{sensorId}', sensor.id);
          const body = JSON.stringify({ sensorId: sensor.id, value, ts, unit: sensor.unit });
          client.publish(topic, body, { qos: 0 });
          emitOutbox({
            gatewayId,
            topic,
             payloadSummary: JSON.stringify({ sensorId: sensor.id, value }).slice(0, 80),
             ts,
             readings: Array.isArray(value)
               ? value.map((v, idx) => ({ sensorId: `${sensor.id}-${idx + 1}`, value: v }))
               : [{ sensorId: sensor.id, value }],
           });
         }
        })();
      }, sensor.intervalMs);
      intervals.push(interval);
    }
  });

  client.on('message', (topic, payload) => {
    const evt = parseInboundEvent({
      topic,
      payload,
      siteGroupId: gw.siteGroupId,
      gatewayClientId: gw.clientId,
    });
    if (!evt) return;
    simulatorEvents.emit('siteGroupInbound', evt);
    simulatorEvents.emit(`siteGroupInbound:${gw.siteGroupId}`, evt);
  });

  client.on('error', (err) => {
    logger.error({ gatewayId, err: err.message }, 'Gateway error');
    emitStatus(gatewayId, 'error', err.message);
    void updateStatus(gatewayId, 'error', err.message);
  });

  client.on('close', () => {
    logger.info({ gatewayId }, 'Gateway disconnected');
    emitStatus(gatewayId, 'disconnected');
    void updateStatus(gatewayId, 'disconnected');
  });
}

export async function stopGateway(gatewayId: string): Promise<void> {
  const runtime = runtimes.get(gatewayId);
  if (!runtime) return;

  // Clear sensor intervals
  for (const interval of runtime.intervals) {
    clearInterval(interval);
  }

  try {
    const gw = await loadGateway(gatewayId);
    if (gw.mode === 'cbor-modules-cloud' && runtime.client.connected) {
      const ndeath = encodeNdeath(gw);
      const topic = topicFor(gw, 'NDEATH');
      await new Promise<void>((resolve) => {
        runtime.client.publish(topic, ndeath, { qos: 1, retain: false }, () => resolve());
        emitOutbox({
          gatewayId,
          topic,
          payloadSummary: 'NDEATH',
          ts: Date.now(),
        });
      });
    }
  } catch (err) {
    logger.warn({ gatewayId, err }, 'Error publishing NDEATH on stop');
  }

  runtime.client.end(true);
  runtimes.delete(gatewayId);

  await prisma.gateway.update({
    where: { id: gatewayId },
    data: { desiredState: 'stopped', lastStatus: 'stopped', lastError: null },
  });

  emitStatus(gatewayId, 'stopped');
  logger.info({ gatewayId }, 'Gateway stopped');
}

export function gatewayStatus(gatewayId: string): { status: string; connected: boolean } {
  const runtime = runtimes.get(gatewayId);
  if (!runtime) {
    return { status: 'stopped', connected: false };
  }
  return {
    status: runtime.client.connected ? 'connected' : 'connecting',
    connected: runtime.client.connected,
  };
}

export function activeGatewayIds(): string[] {
  return Array.from(runtimes.keys());
}

export async function reconcileSiteGroup(siteGroupId: string): Promise<void> {
  const devices = await prisma.device.findMany({
    where: { siteGroupId, simulationDesired: true },
    include: { children: true },
    orderBy: { parentDeviceKey: 'asc' },
  });

  const byParent = new Map<string | null, typeof devices>();
  for (const device of devices) {
    const key = device.parentDeviceKey;
    const group = byParent.get(key) ?? [];
    group.push(device);
    byParent.set(key, group);
  }

  const parentDevices = byParent.get(null) ?? [];
  const desiredGatewayIds = new Set<string>();
  for (const gatewayDevice of parentDevices) {
    const manifest = getDeviceType(gatewayDevice.deviceTypeId);
    if (!manifest || manifest.category !== 'gateway') continue;
    const gateway = await prisma.gateway.findUnique({ where: { deviceKey: gatewayDevice.deviceKey } });
    if (!gateway) continue;
    desiredGatewayIds.add(gateway.id);
    const children = byParent.get(gatewayDevice.deviceKey) ?? [];
    if (children.length === 0) {
      logger.warn({ event: 'sim-falling-back-to-jsonb', gatewayId: gateway.id });
      await startGateway(gateway.id);
      continue;
    }
    const sensors: SensorConfig[] = children.map((child) => {
      const signal = ((child.config as Record<string, unknown> | null)?.signal ?? {}) as Record<string, unknown>;
      const manifest = getDeviceType(child.deviceTypeId);
      const defaults = manifest?.defaultSignal;
      const sensorType: SensorConfig['type'] = isSensorType(signal.type) ? signal.type : 'temperature';
      return {
        id: child.canvasNodeId,
        label: child.canvasNodeId,
        unit: typeof signal.unit === 'string' ? signal.unit : defaults?.units ?? 'raw',
        type: sensorType,
        pattern: isPattern(signal.pattern) ? signal.pattern : 'random-walk',
        min: typeof signal.min === 'number' ? signal.min : 0,
        max: typeof signal.max === 'number' ? signal.max : 100,
        walkStep: typeof signal.walkStep === 'number' ? signal.walkStep : 1,
        intervalMs: typeof signal.intervalMs === 'number' ? signal.intervalMs : defaults?.rateMs ?? 1000,
        deviceTypeId: child.deviceTypeId,
      };
    });
    await startGateway(gateway.id, sensors);
  }

  for (const runtime of runtimes.values()) {
    if (runtime.siteGroupId === siteGroupId && !desiredGatewayIds.has(runtime.gatewayId)) {
      await stopGateway(runtime.gatewayId);
    }
  }

  if (!siteGroupLoops.has(siteGroupId)) {
    const loop = setInterval(() => {
      void reconcileSiteGroup(siteGroupId);
    }, reconcileMs);
    siteGroupLoops.set(siteGroupId, loop);
  }
}
