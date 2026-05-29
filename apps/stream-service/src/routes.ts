import { Hono } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import { decode } from 'cbor-x';
import mqtt from 'mqtt';
import pino from 'pino';
import { jwtVerify } from 'jose';
import { prisma } from '@controlai-web/db';
import type { TelemetryMessage } from '@controlai-web/shared-types';

const logger = pino({ name: 'stream-service-routes' });
const app = new Hono();
const brokerUrl = process.env.MQTT_BROKER_URL ?? 'mqtts://43.203.6.179:8883';
const tlsInsecure = process.env.STREAM_TLS_INSECURE === 'true';
const jwtSecret = process.env.STREAM_JWT_SECRET ?? '';

const siteClients = new Map<string, Set<(msg: TelemetryMessage) => void>>();
const msgTs = new Map<string, number[]>();
let brokerConnected = false;

function msgPerSec(clientId: string): number {
  const now = Date.now();
  const arr = (msgTs.get(clientId) ?? []).filter((t) => now - t <= 1000);
  arr.push(now);
  msgTs.set(clientId, arr);
  return arr.length;
}

async function verifyToken(token: string, siteId: string): Promise<boolean> {
  if (!jwtSecret) return false;
  const secret = new TextEncoder().encode(jwtSecret);
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return payload.siteId === siteId;
}

function fanout(siteId: string, msg: TelemetryMessage): void {
  const listeners = siteClients.get(siteId);
  if (!listeners) return;
  for (const listener of listeners) listener(msg);
}

export async function startBridge(): Promise<void> {
  const client = mqtt.connect(brokerUrl, {
    rejectUnauthorized: !tlsInsecure,
  });

  client.on('connect', () => {
    brokerConnected = true;
    client.subscribe('modules/+/+/+');
    logger.info({ brokerUrl }, 'Connected to broker');
  });
  client.on('close', () => {
    brokerConnected = false;
    logger.warn('Broker connection closed');
  });
  client.on('error', (err) => {
    logger.error({ err: err.message, brokerUrl }, 'MQTT error');
  });
  client.on('reconnect', () => {
    logger.info('MQTT reconnecting');
  });
  client.on('message', async (topic, payload) => {
    const parts = topic.split('/');
    if (parts.length !== 4 || parts[0] !== 'modules') return;
    const tenantId = parts[1];
    const msgType = parts[2];
    const clientId = parts[3];
    if (!clientId) return;

    const gateway = await prisma.gateway.findFirst({
      where: { clientId },
      select: { canvasNodeId: true, siteGroupId: true },
    });
    if (!gateway?.canvasNodeId) return;

    const site = await prisma.site.findFirst({
      where: { siteGroupId: gateway.siteGroupId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!site) return;

    const decoded = decode(payload) as unknown;
    fanout(site.id, {
      nodeId: gateway.canvasNodeId,
      siteId: site.id,
      topic,
      payload: { tenantId, msgType, decoded },
      status: brokerConnected ? 'HEALTHY' : 'UNREACHABLE',
      msgPerSec: msgPerSec(clientId),
      timestamp: new Date().toISOString(),
    });
  });
}

app.get('/health', (c) => {
  let subs = 0;
  for (const v of siteClients.values()) subs += v.size;
  return c.json({ ok: true, brokerConnected, siteSubscriberCount: subs });
});

app.get('/sites/:siteId/stream', async (c) => {
  const siteId = c.req.param('siteId');
  const token = c.req.query('token');
  if (!token || !(await verifyToken(token, siteId))) return c.text('Unauthorized', 401);

  return honoStream(c, async (stream) => {
    const send = (msg: TelemetryMessage) => void stream.write(`data: ${JSON.stringify(msg)}\n\n`);
    const set = siteClients.get(siteId) ?? new Set();
    set.add(send);
    siteClients.set(siteId, set);

    const keepAlive = setInterval(() => {
      void stream.write(': heartbeat\n\n');
    }, 25_000);

    await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
    clearInterval(keepAlive);
    set.delete(send);
    if (set.size === 0) siteClients.delete(siteId);
  });
});

export { app };
