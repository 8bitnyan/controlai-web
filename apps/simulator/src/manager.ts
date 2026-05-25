import { EventEmitter } from 'events';
import mqtt, { type MqttClient } from 'mqtt';
import pino from 'pino';
import { prisma } from '@controlai-web/db';
import { decryptToken } from './crypto.js';
import type { GatewayDTO, SensorConfig } from '@controlai-web/shared-types';
import { topicFor, encodeNbirth, encodeNdata, encodeNdeath } from './cbor-codec.js';
import { SignalGenerator } from './signal-generator.js';

const logger = pino({ name: 'simulator-manager' });

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
  generators: Map<string, SignalGenerator>;
  gatewayId: string;
}

export const simulatorEvents = new EventEmitter();
simulatorEvents.setMaxListeners(200);

/** Map<gatewayId, GatewayRuntime> */
const runtimes = new Map<string, GatewayRuntime>();

function emitStatus(gatewayId: string, status: string, error?: string): void {
  const evt: GatewayStatusEvent = { gatewayId, status, error };
  simulatorEvents.emit('gatewayStatus', evt);
  simulatorEvents.emit(`gatewayStatus:${gatewayId}`, evt);
}

function emitOutbox(evt: GatewayOutboxEvent): void {
  simulatorEvents.emit('gatewayOutbox', evt);
  simulatorEvents.emit(`gatewayOutbox:${evt.gatewayId}`, evt);
}

async function loadGateway(gatewayId: string): Promise<GatewayDTO & {
  rootCaPemEnc: string;
  clientCertPemEnc: string;
  clientKeyPemEnc: string;
}> {
  const row = await prisma.gateway.findUniqueOrThrow({ where: { id: gatewayId } });
  return {
    id: row.id,
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

export async function startGateway(gatewayId: string): Promise<void> {
  if (runtimes.has(gatewayId)) {
    logger.info({ gatewayId }, 'Gateway already running');
    return;
  }

  const gw = await loadGateway(gatewayId);
  const rootCaPem = decryptToken(gw.rootCaPemEnc);
  const clientCertPem = decryptToken(gw.clientCertPemEnc);
  const clientKeyPem = decryptToken(gw.clientKeyPemEnc);

  const sensors = gw.sensors as SensorConfig[];

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
    rejectUnauthorized: true,
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

  const generators = new Map<string, SignalGenerator>();
  for (const sensor of sensors) {
    generators.set(sensor.id, new SignalGenerator(sensor));
  }

  const intervals: ReturnType<typeof setInterval>[] = [];
  const runtime: GatewayRuntime = { client, intervals, generators, gatewayId };
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
    }

    // Start per-sensor publish intervals
    for (const sensor of sensors) {
      const gen = generators.get(sensor.id)!;
      const interval = setInterval(() => {
        if (!client.connected) return;
        const value = gen.next();
        const ts = Date.now();

        if (gw.mode === 'cbor-modules-cloud') {
          const readings = [{ sensorId: sensor.id, value, ts }];
          const payload = encodeNdata(gw, readings);
          const topic = topicFor(gw, 'NDATA');
          client.publish(topic, payload, { qos: 0 });
          emitOutbox({
            gatewayId,
            topic,
            payloadSummary: `NDATA ${sensor.id}=${value.toFixed(3)}`,
            ts,
            readings: [{ sensorId: sensor.id, value }],
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
            readings: [{ sensorId: sensor.id, value }],
          });
        }
      }, sensor.intervalMs);
      intervals.push(interval);
    }
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
