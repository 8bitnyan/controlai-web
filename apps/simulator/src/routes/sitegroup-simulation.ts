import { Hono } from 'hono';
import { reconcileSiteGroup } from '../manager.js';

export const sitegroupSimulationRoute = new Hono();

sitegroupSimulationRoute.post('/sitegroups/:siteGroupId/simulation', async (c) => {
  const token = c.req.header('X-Sim-Token');
  if (!token || token !== process.env.SIMULATOR_SHARED_TOKEN) {
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
