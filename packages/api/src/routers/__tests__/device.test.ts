import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../../root';
import { writeAudit } from '../../lib/audit-writer';

vi.mock('../../lib/audit-writer', () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

const ORG_ID = 'cmorg000000000000000000001';
const SG1 = 'cmsitegroup0000000000000001';
const SG2 = 'cmsitegroup0000000000000002';

function makePrisma() {
  return {
    organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    device: {
      findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makeCaller(prisma: ReturnType<typeof makePrisma>) {
  const now = new Date();
  const ctx = {
    prisma,
    session: {
      session: { id: 's1', createdAt: now, updatedAt: now, userId: 'u1', expiresAt: now, token: 't1' },
      user: { id: 'u1', createdAt: now, updatedAt: now, email: 'u1@example.com', emailVerified: true, name: 'u1' },
    },
    userId: 'u1',
    orgId: ORG_ID,
    orgRole: 'OWNER',
    req: new Request('http://localhost'),
  } as unknown as Parameters<typeof appRouter.createCaller>[0];
  return appRouter.createCaller(ctx);
}

const baseCreate = { orgId: ORG_ID, siteGroupId: SG1, canvasNodeId: 'n1', deviceTypeId: 'core-generic-sensor' };

describe('device router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  describe('create', () => {
    it('creates row + audit', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      p.device.create.mockResolvedValue({ deviceKey: 'd1' });
      await makeCaller(p).device.create(baseCreate);
      expect(p.device.create).toHaveBeenCalledOnce();
      expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'device.create' }));
    });
    it('unknown deviceTypeId -> BAD_REQUEST', async () => {
      const p = makePrisma();
      await expect(makeCaller(p).device.create({ ...baseCreate, deviceTypeId: 'unknown-x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
    it('parent in different siteGroup -> BAD_REQUEST', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValueOnce({ deviceKey: 'p1', siteGroupId: SG2 });
      await expect(makeCaller(p).device.create({ ...baseCreate, parentDeviceKey: 'p1' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
    it('canvasNodeId collision -> CONFLICT', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValueOnce({ deviceKey: 'd0' });
      await expect(makeCaller(p).device.create(baseCreate)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
    it('allows same-site parent', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValueOnce({ deviceKey: 'p1', siteGroupId: SG1 }).mockResolvedValueOnce(null);
      p.device.create.mockResolvedValue({ deviceKey: 'd1' });
      await expect(makeCaller(p).device.create({ ...baseCreate, parentDeviceKey: 'p1' })).resolves.toBeDefined();
    });
    it('defaults simulationDesired=true', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      p.device.create.mockResolvedValue({ deviceKey: 'd1' });
      await makeCaller(p).device.create(baseCreate);
      expect(p.device.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ simulationDesired: true }) }));
    });
  });

  describe('update', () => {
    it('updates config + writes audit', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'UNREGISTERED' });
      p.device.update.mockResolvedValue({ deviceKey: 'd1' });
      await makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', config: { a: 1 } });
      expect(p.device.update).toHaveBeenCalledOnce();
      expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'device.update' }));
    });
    it('config locked when not UNREGISTERED', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'REGISTERED' });
      await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', config: { a: 1 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
    it('portBindings locked when REGISTERED', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'REGISTERED' });
      await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', portBindings: { p: 1 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
    it('simulationDesired editable when REGISTERED', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'REGISTERED' });
      p.device.update.mockResolvedValue({ deviceKey: 'd1', simulationDesired: false });
      await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', simulationDesired: false })).resolves.toBeDefined();
    });
    it('simulationDesired editable when REGISTERING', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'REGISTERING' });
      p.device.update.mockResolvedValue({ deviceKey: 'd1', simulationDesired: false });
      await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', simulationDesired: false })).resolves.toBeDefined();
    });
    it('simulationDesired editable when ORPHANED', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'ORPHANED' });
      p.device.update.mockResolvedValue({ deviceKey: 'd1', simulationDesired: true });
      await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', simulationDesired: true })).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('UNREGISTERED hard delete + audit', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'UNREGISTERED' });
      await makeCaller(p).device.delete({ orgId: ORG_ID, deviceKey: 'd1' });
      expect(p.device.delete).toHaveBeenCalledOnce();
      expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'device.delete-hard' }));
    });
    it('REGISTERED soft archive + audit', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'REGISTERED' });
      await makeCaller(p).device.delete({ orgId: ORG_ID, deviceKey: 'd1' });
      expect(p.device.update).toHaveBeenCalledWith(expect.objectContaining({ data: { registrationState: 'ORPHANED' } }));
      expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'device.soft-archive' }));
    });
    it('missing device -> NOT_FOUND', async () => {
      const p = makePrisma();
      p.device.findUnique.mockResolvedValue(null);
      await expect(makeCaller(p).device.delete({ orgId: ORG_ID, deviceKey: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list', () => {
    it('filter by siteGroupId', async () => { const p = makePrisma(); p.device.findMany.mockResolvedValue([]); await makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1 }); expect(p.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siteGroupId: SG1 }) })); });
    it('filter by registrationState', async () => { const p = makePrisma(); p.device.findMany.mockResolvedValue([]); await makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1, registrationState: 'REGISTERED' }); expect(p.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ registrationState: 'REGISTERED' }) })); });
    it('filter by deviceTypeId', async () => { const p = makePrisma(); p.device.findMany.mockResolvedValue([]); await makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1, deviceTypeId: 'core-generic-sensor' }); expect(p.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deviceTypeId: 'core-generic-sensor' }) })); });
    it('filter by parentDeviceKey', async () => { const p = makePrisma(); p.device.findMany.mockResolvedValue([]); await makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1, parentDeviceKey: 'p1' }); expect(p.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ parentDeviceKey: 'p1' }) })); });
    it('orders by createdAt DESC', async () => { const p = makePrisma(); p.device.findMany.mockResolvedValue([]); await makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1 }); expect(p.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } })); });
    it('returns query result', async () => { const p = makePrisma(); const rows = [{ deviceKey: 'd1' }]; p.device.findMany.mockResolvedValue(rows); await expect(makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1 })).resolves.toEqual(rows); });
  });

  describe('setSiteGroupSimulation', () => {
    it('bulk updates all in siteGroup', async () => { const p = makePrisma(); p.device.updateMany.mockResolvedValue({ count: 3 }); await makeCaller(p).device.setSiteGroupSimulation({ orgId: ORG_ID, siteGroupId: SG1, desired: true }); expect(p.device.updateMany).toHaveBeenCalledWith({ where: { siteGroupId: SG1 }, data: { simulationDesired: true } }); });
    it('POSTs to simulator endpoint', async () => { const p = makePrisma(); p.device.updateMany.mockResolvedValue({ count: 1 }); await makeCaller(p).device.setSiteGroupSimulation({ orgId: ORG_ID, siteGroupId: SG1, desired: true }); expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(`/sitegroups/${SG1}/simulation`), expect.objectContaining({ method: 'POST' })); });
    it('writes bulk toggle audit', async () => { const p = makePrisma(); p.device.updateMany.mockResolvedValue({ count: 2 }); await makeCaller(p).device.setSiteGroupSimulation({ orgId: ORG_ID, siteGroupId: SG1, desired: false }); expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'device.bulk-simulation-toggle' })); });
    it('tolerates simulator failure', async () => { const p = makePrisma(); p.device.updateMany.mockResolvedValue({ count: 2 }); vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('down')); await expect(makeCaller(p).device.setSiteGroupSimulation({ orgId: ORG_ID, siteGroupId: SG1, desired: false })).resolves.toMatchObject({ simulatorContact: 'failed' }); });
    it('returns affectedCount', async () => { const p = makePrisma(); p.device.updateMany.mockResolvedValue({ count: 9 }); await expect(makeCaller(p).device.setSiteGroupSimulation({ orgId: ORG_ID, siteGroupId: SG1, desired: false })).resolves.toMatchObject({ affectedCount: 9 }); });
  });

  describe('extra coverage', () => {
    it('create accepts explicit simulationDesired false', async () => { const p = makePrisma(); p.device.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null); p.device.create.mockResolvedValue({ deviceKey: 'd1' }); await makeCaller(p).device.create({ ...baseCreate, simulationDesired: false }); expect(p.device.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ simulationDesired: false }) })); });
    it('update missing row -> NOT_FOUND', async () => { const p = makePrisma(); p.device.findUnique.mockResolvedValue(null); await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' }); });
    it('update allows config change when UNREGISTERED', async () => { const p = makePrisma(); p.device.findUnique.mockResolvedValue({ deviceKey: 'd1', registrationState: 'UNREGISTERED' }); p.device.update.mockResolvedValue({ deviceKey: 'd1' }); await expect(makeCaller(p).device.update({ orgId: ORG_ID, deviceKey: 'd1', config: { x: 1 }, portBindings: { p: 1 } })).resolves.toBeDefined(); });
    it('setSiteGroupSimulation success payload', async () => { const p = makePrisma(); p.device.updateMany.mockResolvedValue({ count: 1 }); await expect(makeCaller(p).device.setSiteGroupSimulation({ orgId: ORG_ID, siteGroupId: SG1, desired: true })).resolves.toEqual({ success: true, affectedCount: 1, simulatorContact: 'ok' }); });
    it('list with all filters keeps all where fields', async () => { const p = makePrisma(); p.device.findMany.mockResolvedValue([]); await makeCaller(p).device.list({ orgId: ORG_ID, siteGroupId: SG1, registrationState: 'REGISTERED', deviceTypeId: 'core-generic-sensor', parentDeviceKey: 'p1' }); expect(p.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteGroupId: SG1, registrationState: 'REGISTERED', deviceTypeId: 'core-generic-sensor', parentDeviceKey: 'p1' } })); });
  });
});
