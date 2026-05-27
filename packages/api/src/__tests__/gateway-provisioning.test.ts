import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.INSTANCE_TOKEN_KEY = 'c'.repeat(64);

vi.mock('../lib/audit-writer', () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { appRouter } from '../root';
import { encryptToken } from '../lib/crypto';
import { writeAudit } from '../lib/audit-writer';

function makeMockPrisma() {
  return {
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }),
    },
    gateway: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function makeCaller(prisma: ReturnType<typeof makeMockPrisma>) {
  return appRouter.createCaller({
    prisma: prisma as any,
    session: { user: { id: 'user1' } } as any,
    userId: 'user1',
    orgId: null,
    orgRole: null,
    req: new Request('http://localhost'),
  } as any);
}

describe('gateway provisioning procedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getProvisioningBundle returns hex arrays and writes start audit', async () => {
    const prisma = makeMockPrisma();
    prisma.gateway.findFirst.mockResolvedValue({
      id: 'cmgw000000000000000000001',
      groupId: 'group-1',
      endpointURL: 'mqtts://broker.example.com:8883',
      rootCaPemEnc: encryptToken('-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----'),
      clientCertPemEnc: encryptToken('-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----'),
      clientKeyPemEnc: encryptToken('-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----'),
      siteGroup: { project: { orgId: 'cmorg000000000000000000001' } },
    });

    const caller = makeCaller(prisma);
    const result = await caller.gateway.getProvisioningBundle({
      orgId: 'cmorg000000000000000000001',
      gatewayId: 'cmgw000000000000000000001',
    });

    expect(result.groupId).toBe('group-1');
    expect(result.endpointURL).toBe('mqtts://broker.example.com:8883');
    expect(result.rootCaHex.length).toBeGreaterThan(0);
    expect(result.clientCertHex.length).toBeGreaterThan(0);
    expect(result.clientKeyHex.length).toBeGreaterThan(0);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'gateway.provision-start' }),
    );
  });

  it('getProvisioningBundle throws PRECONDITION_FAILED when cert is missing', async () => {
    const prisma = makeMockPrisma();
    prisma.gateway.findFirst.mockResolvedValue({
      id: 'cmgw000000000000000000001',
      groupId: 'group-1',
      endpointURL: 'mqtts://broker.example.com:8883',
      rootCaPemEnc: '',
      clientCertPemEnc: encryptToken('-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----'),
      clientKeyPemEnc: encryptToken('-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----'),
      siteGroup: { project: { orgId: 'cmorg000000000000000000001' } },
    });

    const caller = makeCaller(prisma);
    await expect(
      caller.gateway.getProvisioningBundle({
        orgId: 'cmorg000000000000000000001',
        gatewayId: 'cmgw000000000000000000001',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('getProvisioningBundle throws FORBIDDEN for different org', async () => {
    const prisma = makeMockPrisma();
    prisma.gateway.findFirst.mockResolvedValue({
      id: 'cmgw000000000000000000001',
      siteGroup: { project: { orgId: 'cmorg000000000000000000999' } },
    });

    const caller = makeCaller(prisma);
    await expect(
      caller.gateway.getProvisioningBundle({
        orgId: 'cmorg000000000000000000001',
        gatewayId: 'cmgw000000000000000000001',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('recordProvisionSuccess updates gateway and writes audit', async () => {
    const prisma = makeMockPrisma();
    prisma.gateway.findFirst.mockResolvedValue({
      id: 'cmgw000000000000000000001',
      siteGroup: { project: { orgId: 'cmorg000000000000000000001' } },
    });
    prisma.gateway.update.mockResolvedValue({});

    const caller = makeCaller(prisma);
    const result = await caller.gateway.recordProvisionSuccess({
      orgId: 'cmorg000000000000000000001',
      gatewayId: 'cmgw000000000000000000001',
      deviceSerial: 'SER-1',
      durationMs: 1234,
      completedSteps: ['step1', 'step2'],
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.gateway.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cmgw000000000000000000001' },
        data: expect.objectContaining({ lastProvisionedDeviceSerial: 'SER-1' }),
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'gateway.provision-success' }),
    );
  });

  it('recordProvisionFailure does not update gateway and writes audit', async () => {
    const prisma = makeMockPrisma();
    prisma.gateway.findFirst.mockResolvedValue({
      id: 'cmgw000000000000000000001',
      siteGroup: { project: { orgId: 'cmorg000000000000000000001' } },
    });

    const caller = makeCaller(prisma);
    const result = await caller.gateway.recordProvisionFailure({
      orgId: 'cmorg000000000000000000001',
      gatewayId: 'cmgw000000000000000000001',
      deviceSerial: 'SER-1',
      durationMs: 500,
      stepReached: 'device.writeCerts',
      failureReason: 'timeout',
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.gateway.update).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'gateway.provision-failed' }),
    );
  });
});
