import mqtt, { type MqttClient } from 'mqtt';
import { checkServerIdentity as tlsCheckServerIdentity } from 'node:tls';
import { decode as cborDecode } from 'cbor-x';
import { prisma } from '@controlai-web/db';
import { sseFanout } from './sse-fanout';
import { writeMessage } from './redis-writer';

interface SiteClientState {
  client: MqttClient;
  idleTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
}

const IDLE_TIMEOUT_MS = 60_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const LAST_SEEN_THROTTLE_MS = 30_000;
const MODULES_NDATA_TOPIC_RE = /^modules\/[^/]+\/NDATA\/([^/]+)$/;

const lastSeenWriteByDeviceKey = new Map<string, number>();

const logger = {
  warn: (payload: { event: string; err: unknown }) => {
    console.warn(payload);
  },
};

/** Map<siteId, SiteClientState> */
const clients = new Map<string, SiteClientState>();

export interface BrokerConfig {
  url: string; // mqtts://host:port or mqtt://host:port
  servername?: string;
  host?: string;
  port?: number;
  caCert?: string; // PEM
  clientCert?: string; // PEM
  clientKey?: string; // PEM
  username?: string;
  password?: string;
}

/**
 * Ensure an MQTT client exists for the given site.
 * Creates one if not yet present; resets idle timer if it exists.
 */
export function ensureSiteClient(siteId: string, config: BrokerConfig): void {
  const existing = clients.get(siteId);

  if (existing) {
    // Reset idle timer — a new subscriber just connected
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    return;
  }

  createClient(siteId, config);
}

function createClient(siteId: string, config: BrokerConfig): void {
  // Validate cert SAN against the SNI hostname we send, not against the TCP host.
  const checkServerIdentity = config.servername
    ? (_host: string, cert: import('node:tls').PeerCertificate) =>
        tlsCheckServerIdentity(config.servername!, cert)
    : undefined;

  const tlsOptions =
    config.clientCert && config.clientKey
      ? {
          ca: config.caCert,
          cert: config.clientCert,
          key: config.clientKey,
          rejectUnauthorized: !!config.caCert,
          servername: config.servername,
          ...(checkServerIdentity
            ? ({ checkServerIdentity } as unknown as Record<string, unknown>)
            : {}),
        }
      : {};

  const client = mqtt.connect(config.url, {
    clean: true,
    reconnectPeriod: 0, // we manage reconnect manually with backoff
    username: config.username,
    password: config.password,
    ...tlsOptions,
  });

  const state: SiteClientState = { client, idleTimer: null, reconnectDelay: MIN_BACKOFF_MS };
  clients.set(siteId, state);

  client.on('connect', () => {
    state.reconnectDelay = MIN_BACKOFF_MS;
    client.subscribe('#', { qos: 1 }, (err) => {
      if (err) {
        console.error(`[mqtt:${siteId}] subscribe error:`, err.message);
      }
    });
  });

  client.on('message', (topic, payload) => {
    let parsed: unknown;
    let parseError: string | undefined;

    if (topic.startsWith('modules/')) {
      // Attempt CBOR decode first for modules_cloud-main topics
      try {
        const decoded = cborDecode(payload) as Record<string, unknown>;
        // Re-shape to a JSON-friendly form: convert Uint8Array id to hex string
        if (decoded && typeof decoded === 'object') {
          if (decoded['id'] instanceof Uint8Array) {
            decoded['id'] = Buffer.from(decoded['id']).toString('hex');
          }
        }
        parsed = decoded;
      } catch {
        // Fall through to JSON / raw
        try {
          parsed = JSON.parse(payload.toString());
        } catch {
          parsed = payload.toString('base64');
          parseError = 'cbor_and_json_parse_failed';
        }
      }
    } else {
      try {
        parsed = JSON.parse(payload.toString());
      } catch {
        parsed = payload.toString();
      }
    }

    const ndataMatch = MODULES_NDATA_TOPIC_RE.exec(topic);
    if (ndataMatch) {
      const clientId = ndataMatch[1];
      void prisma.gateway
        .findFirst({
          where: { clientId },
          select: { deviceKey: true },
        })
        .then((gateway) => {
          if (!gateway?.deviceKey) return;
          const now = Date.now();
          const lastWriteTs = lastSeenWriteByDeviceKey.get(gateway.deviceKey);
          if (lastWriteTs !== undefined && now - lastWriteTs <= LAST_SEEN_THROTTLE_MS) return;
          lastSeenWriteByDeviceKey.set(gateway.deviceKey, now);
          void prisma.device
            .update({
              where: { deviceKey: gateway.deviceKey },
              data: { lastSeenAt: new Date() },
            })
            .catch((err: unknown) => logger.warn({ event: 'device-lastseen-update-failed', err }));
        })
        .catch((err: unknown) => logger.warn({ event: 'device-lastseen-update-failed', err }));
    }

    const message = JSON.stringify({
      nodeId: siteId, // broker nodeId mapped to siteId for telemetry overlay
      siteId,
      topic,
      payload: parsed,
      timestamp: new Date().toISOString(),
      ...(parseError ? { parseError } : {}),
    });

    sseFanout.emit(siteId, message);
    void writeMessage(siteId, topic, parsed);
  });

  client.on('error', (err) => {
    console.error(`[mqtt:${siteId}] error:`, err.message);
  });

  client.on('close', () => {
    // Emit retry hint to SSE clients
    const retryMs = state.reconnectDelay;
    sseFanout.emit(siteId, `retry: ${retryMs}\n`);

    // Exponential backoff reconnect
    if (sseFanout.subscriberCount(siteId) > 0) {
      setTimeout(() => {
        if (clients.has(siteId)) {
          client.reconnect();
        }
      }, state.reconnectDelay);
      state.reconnectDelay = Math.min(state.reconnectDelay * 2, MAX_BACKOFF_MS);
    }
  });
}

/**
 * Called when an SSE client disconnects.
 * Starts a 60s idle timer; if no new subscribers arrive, closes the MQTT client.
 */
export function onSseClientDisconnected(siteId: string): void {
  const state = clients.get(siteId);
  if (!state) return;

  if (sseFanout.subscriberCount(siteId) > 0) return;

  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (sseFanout.subscriberCount(siteId) === 0) {
      state.client.end(true);
      clients.delete(siteId);
    }
  }, IDLE_TIMEOUT_MS);
}

export function getActiveSiteCount(): number {
  return clients.size;
}
