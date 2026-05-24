import { serve } from '@hono/node-server';
import pino from 'pino';
import { app } from './routes.js';
import { reconcileOnBoot } from './boot-reconcile.js';

const logger = pino({ name: 'simulator' });
const port = Number(process.env.SIMULATOR_PORT ?? 4001);

async function main(): Promise<void> {
  // Start the HTTP server
  serve({ fetch: app.fetch, port }, (info) => {
    logger.info({ port: info.port }, 'Simulator HTTP server listening');
  });

  // Reconcile gateways that should be running
  try {
    await reconcileOnBoot();
  } catch (err) {
    logger.error({ err }, 'Boot reconciliation failed');
  }
}

void main();
