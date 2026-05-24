import mqtt, { type MqttClient } from 'mqtt';
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

/** Map<siteId, SiteClientState> */
const clients = new Map<string, SiteClientState>();

export interface BrokerConfig {
  url: string; // mqtts://host:port or mqtt://host:port
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
  const tlsOptions =
    config.clientCert && config.clientKey
      ? {
          ca: config.caCert,
          cert: config.clientCert,
          key: config.clientKey,
          rejectUnauthorized: !!config.caCert,
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
    try {
      parsed = JSON.parse(payload.toString());
    } catch {
      parsed = payload.toString();
    }

    const message = JSON.stringify({
      nodeId: siteId, // broker nodeId mapped to siteId for telemetry overlay
      siteId,
      topic,
      payload: parsed,
      timestamp: new Date().toISOString(),
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
