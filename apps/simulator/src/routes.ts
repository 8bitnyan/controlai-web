import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import { startGateway, stopGateway, gatewayStatus, simulatorEvents } from './manager.js';
import { requireToken } from './jwt.js';
import type { GatewayStatusEvent, GatewayOutboxEvent } from './manager.js';
import { sitegroupSimulationRoute } from './routes/sitegroup-simulation.js';

const logger = pino({ name: 'simulator-routes' });

export const app = new Hono();

// CORS must be registered BEFORE any route so EventSource (cross-origin from
// the Next.js dev server on :3000) gets `Access-Control-Allow-Origin` headers.
app.use(
  '*',
  cors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  }),
);

app.route('/', sitegroupSimulationRoute);

// ─── Gateway control ──────────────────────────────────────────────────────────

app.post('/gateways/:id/start', async (c) => {
  const id = c.req.param('id');
  try {
    await startGateway(id);
    return c.json({ ok: true, gatewayId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ gatewayId: id, err: message }, 'Failed to start gateway');
    return c.json({ ok: false, error: message }, 500);
  }
});

app.post('/gateways/:id/stop', async (c) => {
  const id = c.req.param('id');
  try {
    await stopGateway(id);
    return c.json({ ok: true, gatewayId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ gatewayId: id, err: message }, 'Failed to stop gateway');
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get('/gateways/:id/status', (c) => {
  const id = c.req.param('id');
  const status = gatewayStatus(id);
  return c.json({ gatewayId: id, ...status });
});

// ─── SSE: global status stream ─────────────────────────────────────────────────

app.get('/events', (c) => {
  const tokenResult = requireToken(c, async () => {});
  if (tokenResult instanceof Promise) {
    // Check synchronously via query param presence
  }
  const token = c.req.query('token');
  if (!token) {
    return c.text('Unauthorized', 401);
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) });

    const onStatus = (evt: GatewayStatusEvent) => {
      void stream.writeSSE({ data: JSON.stringify({ type: 'status', ...evt }) });
    };

    simulatorEvents.on('gatewayStatus', onStatus);

    // Keep alive every 30s (SSE comment line)
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ data: '', event: 'ping' });
    }, 30_000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
    simulatorEvents.off('gatewayStatus', onStatus);
    clearInterval(keepAlive);
  });
});

// ─── SSE: per-gateway outbox ───────────────────────────────────────────────────

app.get('/gateways/:id/outbox', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');
  if (!token) {
    return c.text('Unauthorized', 401);
  }

  // Verify JWT before opening stream
  try {
    const { requireToken: _verify, verifyStreamToken } = await import('./jwt.js');
    await verifyStreamToken(token);
  } catch {
    return c.text('Unauthorized: invalid token', 401);
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected', gatewayId: id }) });

    const onOutbox = (evt: GatewayOutboxEvent) => {
      void stream.writeSSE({ data: JSON.stringify({ type: 'outbox', ...evt }) });
    };

    simulatorEvents.on(`gatewayOutbox:${id}`, onOutbox);

    const keepAlive = setInterval(() => {
      void stream.writeSSE({ data: '', event: 'ping' });
    }, 30_000);

    // Hold the SSE open until the client disconnects or the stream is aborted.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });

    simulatorEvents.off(`gatewayOutbox:${id}`, onOutbox);
    clearInterval(keepAlive);
  });
});

app.get('/sitegroups/:id/inbound', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');
  if (!token) return c.text('Unauthorized', 401);
  try {
    await import('./jwt.js').then(({ verifyStreamToken }) => verifyStreamToken(token));
  } catch {
    return c.text('Unauthorized: invalid token', 401);
  }
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected', siteGroupId: id }) });
    const onInbound = (evt: unknown) => {
      void stream.writeSSE({ data: JSON.stringify(evt) });
    };
    simulatorEvents.on(`siteGroupInbound:${id}`, onInbound);
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ data: '', event: 'ping' });
    }, 30_000);
    await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
    simulatorEvents.off(`siteGroupInbound:${id}`, onInbound);
    clearInterval(keepAlive);
  });
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ ok: true }));
