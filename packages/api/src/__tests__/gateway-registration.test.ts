import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../root';
import { writeAudit } from '../lib/audit-writer';
import { proposeRegistrationMatch } from '../lib/registration-matcher';
import { revokeCert } from '../lib/daemon-cert-revoke';

vi.mock('../lib/audit-writer', () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/registration-matcher', () => ({ proposeRegistrationMatch: vi.fn() }));
vi.mock('../lib/daemon-cert-revoke', () => ({ revokeCert: vi.fn(async () => ({ ok: true })) }));

const ORG_ID = 'cmorg000000000000000000001';
const SESSION_ID = 'cmrp000000000000000000001';
const SITE_GROUP_ID = 'cmsitegroup0000000000000001';

function makePrisma() {
  const prisma = {
    organizationMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    $transaction: vi.fn(),
    device: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    registrationProposal: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  return prisma;
}

function makeCaller(prisma: ReturnType<typeof makePrisma>) {
  return appRouter.createCaller({
    prisma,
    session: { user: { id: 'u1' } },
    userId: 'u1',
    orgId: ORG_ID,
    orgRole: 'OWNER',
    req: new Request('http://localhost'),
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

describe('gateway registration router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1) begin happy', async () => {
    const p = makePrisma();
    p.device.findUnique.mockResolvedValue({ deviceKey: 'gw1' });
    p.registrationProposal.findFirst.mockResolvedValue(null);
    p.registrationProposal.create.mockResolvedValue({ id: SESSION_ID });
    const out = await makeCaller(p).gateway.beginRegistration({ orgId: ORG_ID, gatewayDeviceKey: 'gw1' });
    expect(out).toEqual({ registrationSessionId: SESSION_ID, resumed: false });
    expect(p.device.updateMany).toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'gateway.register-start' }));
  });

  it('2) begin idempotent', async () => {
    const p = makePrisma();
    p.device.findUnique.mockResolvedValue({ deviceKey: 'gw1' });
    p.registrationProposal.findFirst.mockResolvedValue({ id: SESSION_ID });
    const out = await makeCaller(p).gateway.beginRegistration({ orgId: ORG_ID, gatewayDeviceKey: 'gw1' });
    expect(out).toEqual({ registrationSessionId: SESSION_ID, resumed: true });
    expect(p.device.updateMany).not.toHaveBeenCalled();
  });

  it('3) propose happy', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() + 10000), gatewayDeviceKey: 'gw1' });
    p.device.findMany.mockResolvedValue([]);
    p.registrationProposal.findFirst.mockResolvedValue(null);
    const matchPlan = { confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [], gatewayMatch: { boardReportedUuid: 'b1' } };
    vi.mocked(proposeRegistrationMatch).mockReturnValue(matchPlan);
    const out = await makeCaller(p).gateway.proposeRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, boardReportedUuid: 'board', discoveredChildren: [] });
    expect(vi.mocked(proposeRegistrationMatch)).toHaveBeenCalled();
    expect(p.registrationProposal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ matchPlanJson: matchPlan }) }));
    expect(out.matchPlan).toEqual(matchPlan);
  });

  it('4) propose expired', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() - 1000), gatewayDeviceKey: 'gw1' });
    await expect(makeCaller(p).gateway.proposeRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, boardReportedUuid: 'board', discoveredChildren: [] })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('5) propose wrong state', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'ABORTED', expiresAt: new Date(Date.now() + 1000), gatewayDeviceKey: 'gw1' });
    await expect(makeCaller(p).gateway.proposeRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, boardReportedUuid: 'board', discoveredChildren: [] })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('6) commit happy new mode', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() + 1000), gatewayDeviceKey: 'gw1', matchPlanJson: { confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [], gatewayMatch: { boardReportedUuid: 'b1' } } });
    p.device.findUnique.mockResolvedValue({ deviceKey: 'gw1', siteGroupId: 'sg1', canvasNodeId: 'n1', realUuid: null });
    const out = await makeCaller(p).gateway.commitRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, decisions: { confirmedMatches: [], acceptExtras: [], rejectShadows: [] }, mode: 'new' });
    expect(out).toEqual({ ok: true, gatewayDeviceKey: 'gw1' });
    expect(p.device.update).toHaveBeenCalled();
    expect(p.registrationProposal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'COMMITTED' }) }));
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'gateway.register-success' }));
  });

  it('7) commit unknownTypes rejected', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() + 1000), gatewayDeviceKey: 'gw1', matchPlanJson: { confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [{ raw: 'x' }], gatewayMatch: { boardReportedUuid: 'b1' } } });
    await expect(makeCaller(p).gateway.commitRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, decisions: { confirmedMatches: [], acceptExtras: [], rejectShadows: [] } })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('8) commit after expiry', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() - 1000), gatewayDeviceKey: 'gw1', matchPlanJson: { confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [], gatewayMatch: { boardReportedUuid: 'b1' } } });
    await expect(makeCaller(p).gateway.commitRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, decisions: { confirmedMatches: [], acceptExtras: [], rejectShadows: [] } })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('9) commit re-register calls revoke + audit', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() + 1000), gatewayDeviceKey: 'gw1', matchPlanJson: { confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [], gatewayMatch: { boardReportedUuid: 'b1' } } });
    p.device.findUnique.mockResolvedValue({ deviceKey: 'gw1', siteGroupId: 'sg1', canvasNodeId: 'n1', realUuid: 'old' });
    await makeCaller(p).gateway.commitRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, decisions: { confirmedMatches: [], acceptExtras: [], rejectShadows: [] }, mode: 're-register' });
    expect(vi.mocked(revokeCert)).toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'gateway.re-register-start' }));
  });

  it('10) commit tx mid-error rejects', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, state: 'PROPOSED', expiresAt: new Date(Date.now() + 1000), gatewayDeviceKey: 'gw1', matchPlanJson: { confirmedMatches: [], unmatchedShadows: [], extras: [], unknownTypes: [], gatewayMatch: { boardReportedUuid: 'b1' } } });
    p.device.findUnique.mockResolvedValue({ deviceKey: 'gw1', siteGroupId: 'sg1', canvasNodeId: 'n1', realUuid: null });
    p.device.update.mockRejectedValue(new Error('boom'));
    await expect(makeCaller(p).gateway.commitRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, decisions: { confirmedMatches: [], acceptExtras: [], rejectShadows: [] } })).rejects.toThrow('boom');
  });

  it('11) abort', async () => {
    const p = makePrisma();
    p.registrationProposal.findUnique.mockResolvedValue({ id: SESSION_ID, gatewayDeviceKey: 'gw1' });
    const out = await makeCaller(p).gateway.abortRegistration({ orgId: ORG_ID, registrationSessionId: SESSION_ID, reason: 'stop' });
    expect(out).toEqual({ ok: true });
    expect(p.device.updateMany).toHaveBeenCalled();
    expect(p.registrationProposal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'ABORTED' }) }));
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'gateway.register-aborted' }));
  });

  it('12) listStuckRegistrations', async () => {
    const p = makePrisma();
    p.registrationProposal.findMany.mockResolvedValue([{ id: 'rp1' }]);
    const out = await makeCaller(p).gateway.listStuckRegistrations({ orgId: ORG_ID, siteGroupId: SITE_GROUP_ID });
    expect(out).toEqual([{ id: 'rp1' }]);
    expect(p.registrationProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: 'PROPOSED' }) }));
  });
});
