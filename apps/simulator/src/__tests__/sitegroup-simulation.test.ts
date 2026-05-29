import { describe, expect, it, vi, beforeEach } from 'vitest';

const { reconcileSiteGroup } = vi.hoisted(() => ({
  reconcileSiteGroup: vi.fn(async () => {}),
}));

vi.mock('../manager.js', async () => {
  const actual = await vi.importActual('../manager.js');
  return {
    ...actual,
    reconcileSiteGroup,
  };
});

import { app } from '../routes.js';

describe('POST /sitegroups/:siteGroupId/simulation', () => {
  beforeEach(() => {
    reconcileSiteGroup.mockClear();
    process.env.SIMULATOR_SHARED_TOKEN = 'shared-token';
  });

  it('returns 401 on invalid token', async () => {
    const res = await app.request('/sitegroups/sg-1/simulation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Sim-Token': 'bad-token' },
      body: JSON.stringify({ desired: true }),
    });

    expect(res.status).toBe(401);
    expect(reconcileSiteGroup).not.toHaveBeenCalled();
  });

  it('calls reconcileSiteGroup when desired=true', async () => {
    const res = await app.request('/sitegroups/sg-2/simulation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Sim-Token': 'shared-token' },
      body: JSON.stringify({ desired: true }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, action: 'reconciled' });
    expect(reconcileSiteGroup).toHaveBeenCalledWith('sg-2');
  });

  it('calls reconcileSiteGroup when desired=false and returns halted', async () => {
    const res = await app.request('/sitegroups/sg-3/simulation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Sim-Token': 'shared-token' },
      body: JSON.stringify({ desired: false }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, action: 'halted' });
    expect(reconcileSiteGroup).toHaveBeenCalledWith('sg-3');
  });
});
