import { Hono } from 'hono';
import { reconcileSiteGroup } from '../manager.js';

export const sitegroupSimulationRoute = new Hono();

sitegroupSimulationRoute.post('/sitegroups/:siteGroupId/simulation', async (c) => {
  // Accept either Authorization: Bearer <SIMULATOR_API_TOKEN> (preferred,
  // matches the rest of the simulator API), or legacy X-Sim-Token against
  // SIMULATOR_SHARED_TOKEN (kept for back-compat).
  const auth = c.req.header('Authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const xSim = c.req.header('X-Sim-Token');
  const apiToken = process.env.SIMULATOR_API_TOKEN;
  const sharedToken = process.env.SIMULATOR_SHARED_TOKEN;
  const ok =
    (apiToken && bearer && bearer === apiToken) ||
    (sharedToken && xSim && xSim === sharedToken);
  if (!ok) {
    return c.text('Unauthorized', 401);
  }

  const body = await c.req.json();
  if (typeof body !== 'object' || body === null || !('desired' in body) || typeof body.desired !== 'boolean') {
    return c.json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const siteGroupId = c.req.param('siteGroupId');
  await reconcileSiteGroup(siteGroupId);

  return c.json({
    ok: true,
    action: body.desired ? 'reconciled' : 'halted',
  });
});
