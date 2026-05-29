import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findManyMock,
  updateMock,
  updateManyMock,
  txMock,
  transactionMock,
  writeAuditMock,
} = vi.hoisted(() => {
  const findMany = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn();
  const tx = {
    registrationProposal: { update },
    device: { updateMany },
  };
  const transaction = vi.fn(async (fn: (innerTx: typeof tx) => Promise<void>) => fn(tx));
  const writeAudit = vi.fn();

  return {
    findManyMock: findMany,
    updateMock: update,
    updateManyMock: updateMany,
    txMock: tx,
    transactionMock: transaction,
    writeAuditMock: writeAudit,
  };
});

vi.mock('@controlai-web/db', () => ({
  prisma: {
    registrationProposal: { findMany: findManyMock },
    $transaction: transactionMock,
  },
}));

vi.mock('../../lib/audit-writer', () => ({
  writeAudit: writeAuditMock,
}));

import { runExpireTick, startRegistrationProposalExpireJob } from '../registration-proposal-expire';

describe('registration-proposal-expire job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    delete process.env.ENABLE_REGISTRATION_PROPOSAL_EXPIRE;
  });

  it('noops when no expired PROPOSED rows', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await runExpireTick(new Date('2026-01-01T00:00:00.000Z'));

    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it('expires proposal, resets REGISTERING gateway/children, writes audit', async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: 'rp-1',
        gatewayDeviceKey: 'dev-gw-1',
      },
    ]);

    await runExpireTick(new Date('2026-01-01T00:00:00.000Z'));

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'rp-1' },
      data: { state: 'EXPIRED' },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        OR: [{ deviceKey: 'dev-gw-1' }, { parentDeviceKey: 'dev-gw-1' }],
        registrationState: 'REGISTERING',
      },
      data: { registrationState: 'UNREGISTERED' },
    });
    expect(writeAuditMock).toHaveBeenCalledWith(expect.any(Object), {
        orgId: '',
        userId: null,
        action: 'gateway.register-expired',
        targetType: 'RegistrationProposal',
        targetId: 'rp-1',
      metadata: {
        proposalId: 'rp-1',
        gatewayDeviceKey: 'dev-gw-1',
      },
    });
  });

  it('does not touch ORPHANED or COMMITTED proposals via PROPOSED-only query', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await runExpireTick(new Date('2026-01-01T00:00:00.000Z'));

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        state: 'PROPOSED',
        expiresAt: { lt: new Date('2026-01-01T00:00:00.000Z') },
      },
      select: {
        id: true,
        gatewayDeviceKey: true,
      },
    });
  });

  it('returns cleanup that clears interval', () => {
    vi.useFakeTimers();
    process.env.ENABLE_REGISTRATION_PROPOSAL_EXPIRE = 'true';
    findManyMock.mockResolvedValue([]);

    const cleanup = startRegistrationProposalExpireJob({ intervalMs: 1234 });
    expect(cleanup).toBeTypeOf('function');

    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    cleanup?.();

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
