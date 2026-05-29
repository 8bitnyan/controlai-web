import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream as honoStream } from 'hono/streaming';
import pino from 'pino';
import { startGateway, stopGateway, gatewayStatus, simulatorEvents } from './manager.js';
import { requireToken } from './jwt.js';
import type { GatewayStatusEvent, GatewayOutboxEvent } from './manager.js';
import { sitegroupSimulationRoute } from './routes/sitegroup-simulation.js';

const logger = pino({ name: 'simulator-routes' });

export const app = new Hono();
app.route('/', sitegroupSimulationRoute);

app.use(
  '*',
  cors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  }),
);

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

  return honoStream(c, async (stream) => {
    stream.write('data: {"type":"connected"}\n\n');

    const onStatus = (evt: GatewayStatusEvent) => {
      void stream.write(`data: ${JSON.stringify({ type: 'status', ...evt })}\n\n`);
    };

    simulatorEvents.on('gatewayStatus', onStatus);

    // Keep alive every 30s
    const keepAlive = setInterval(() => {
      void stream.write(': keep-alive\n\n');
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

  return honoStream(c, async (stream) => {
    void stream.write(`data: ${JSON.stringify({ type: 'connected', gatewayId: id })}\n\n`);

    const onOutbox = (evt: GatewayOutboxEvent) => {
      void stream.write(`data: ${JSON.stringify({ type: 'outbox', ...evt })}\n\n`);
    };

    simulatorEvents.on(`gatewayOutbox:${id}`, onOutbox);

    const keepAlive = setInterval(() => {
      void stream.write(': keep-alive\n\n');
    }, 30_000);

    // Hold the SSE open until the client disconnects or the stream is aborted.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });

    simulatorEvents.off(`gatewayOutbox:${id}`, onOutbox);
    clearInterval(keepAlive);
  });
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ ok: true }));
