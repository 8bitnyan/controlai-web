import { serve } from '@hono/node-server';
import pino from 'pino';
import { app, startBridge } from './routes.js';

const logger = pino({ name: 'stream-service' });
const port = Number(process.env.STREAM_PORT ?? 4002);

async function main(): Promise<void> {
  await startBridge();
  serve({ fetch: app.fetch, port }, (info) => {
    logger.info({ port: info.port }, 'Stream service listening');
  });
}

void main();
