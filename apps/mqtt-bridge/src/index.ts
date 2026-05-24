import { serve } from '@hono/node-server';
import { app } from './server';

const PORT = Number(process.env.PORT ?? 8080);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[mqtt-bridge] listening on http://localhost:${info.port}`);
});
