import { Hono } from 'hono';
import { verifyJWT } from './jwt';
import { getBrokerConfig } from './broker-registry';
import { ensureSiteClient, onSseClientDisconnected } from './mqtt-manager';
import { sseFanout, type SseMessageHandler } from './sse-fanout';
import { readMessagesAfter } from './redis-writer';
import { getHealthStatus } from './health';

const STREAM_JWT_SECRET = process.env.STREAM_JWT_SECRET;

export const app = new Hono();

// ─── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (c) => {
  return c.json(getHealthStatus());
});

// ─── SSE stream endpoint ───────────────────────────────────────────────────────

app.get('/sites/:siteId/stream', async (c) => {
  const siteId = c.req.param('siteId');
  const token = c.req.query('token');

  // Auth
  if (!token) {
    return c.text('Unauthorized', 401);
  }

  if (!STREAM_JWT_SECRET) {
    return c.text('Server misconfiguration', 500);
  }

  let claims: { siteId: string; userId: string };
  try {
    claims = await verifyJWT(token, STREAM_JWT_SECRET);
  } catch {
    return c.text('Unauthorized', 401);
  }

  // siteId mismatch
  if (claims.siteId !== siteId) {
    return c.text('Forbidden', 403);
  }

  // Ensure MQTT client for this site
  const brokerConfig = await getBrokerConfig(siteId);
  if (brokerConfig) {
    ensureSiteClient(siteId, brokerConfig);
  }

  // Last-Event-ID for replay
  const lastEventId = c.req.header('Last-Event-ID');

  // Build SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: string) {
        controller.enqueue(encoder.encode(data));
      }

      // Replay from Redis if Last-Event-ID provided
      if (lastEventId && brokerConfig) {
        // Replay on first topic '#'
        readMessagesAfter(siteId, '#', lastEventId, 100)
          .then((msgs) => {
            for (const msg of msgs) {
              send(`id: ${msg.id}\ndata: ${msg.payload}\n\n`);
            }
          })
          .catch(() => {});
      }

      const handler: SseMessageHandler = (message: string) => {
        if (message.startsWith('retry:')) {
          send(`${message}\n`);
        } else {
          // Generate a simple monotonic ID for SSE event
          const eventId = Date.now().toString();
          send(`id: ${eventId}\ndata: ${message}\n\n`);
        }
      };

      sseFanout.subscribe(siteId, handler);

      // Cleanup on disconnect
      c.req.raw.signal?.addEventListener('abort', () => {
        sseFanout.unsubscribe(siteId, handler);
        onSseClientDisconnected(siteId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
    },
  });
});
