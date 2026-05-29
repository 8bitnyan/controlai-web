import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runCleanupTick } from '../cleanup-failed-provisions';

const { deprovision, writeAudit } = vi.hoisted(() => ({
  deprovision: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('@controlai-web/api', () => ({
  getProvisioner: () => ({ deprovision }),
  writeAudit,
}));

describe('runCleanupTick', () => {
  beforeEach(() => {
    deprovision.mockReset();
    writeAudit.mockReset();
  });

  it('deletes only stale failed rows and reports counts', async () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    const stale = new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1);
    const almost = new Date(now.getTime() - 24 * 60 * 60 * 1000 + 1);

    const tx: any = {
      controlaiInstance: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ status: 'PROVISION_FAILED', provisionerInstanceId: null, baseURL: 'https://a', orgId: 'o1', env: 'prod' })
          .mockResolvedValueOnce({ status: 'PROVISION_FAILED', provisionerInstanceId: null, baseURL: 'https://b', orgId: 'o1', env: 'staging' }),
        delete: vi.fn(),
      },
    };
    const prisma: any = {
      controlaiInstance: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'old', orgId: 'o1', baseURL: 'https://a', provisionerInstanceId: null, env: 'prod', updatedAt: stale },
          { id: 'almost', orgId: 'o1', baseURL: 'https://d', provisionerInstanceId: null, env: 'dev', updatedAt: almost },
        ]),
      },
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    };

    const result = await runCleanupTick(prisma, now);

    expect(prisma.controlaiInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PROVISION_FAILED', updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    );
    expect(tx.controlaiInstance.delete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, deleted: 2, skipped: 0 });
  });

  it('skips delete when status changed mid-flight', async () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    const tx: any = {
      controlaiInstance: {
        findUnique: vi.fn().mockResolvedValue({ status: 'HEALTHY', provisionerInstanceId: null, baseURL: 'https://a', orgId: 'o1', env: 'prod' }),
        delete: vi.fn(),
      },
    };
    const prisma: any = {
      controlaiInstance: {
        findMany: vi.fn().mockResolvedValue([{ id: 'row1', orgId: 'o1', baseURL: 'https://a', provisionerInstanceId: null, env: 'prod' }]),
      },
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    };

    const result = await runCleanupTick(prisma, now);

    expect(tx.controlaiInstance.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, deleted: 0, skipped: 1 });
  });

  it('deprovisions when instance id exists and still deletes on deprovision failure', async () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    deprovision.mockRejectedValueOnce(new Error('boom'));
    const tx: any = {
      controlaiInstance: {
        findUnique: vi.fn().mockResolvedValue({ status: 'PROVISION_FAILED', provisionerInstanceId: 'prov-1', baseURL: 'https://a', orgId: 'o1', env: 'prod' }),
        delete: vi.fn(),
      },
    };
    const prisma: any = {
      controlaiInstance: {
        findMany: vi.fn().mockResolvedValue([{ id: 'row1', orgId: 'o1', baseURL: 'https://a', provisionerInstanceId: 'prov-1', env: 'prod' }]),
      },
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    };

    const result = await runCleanupTick(prisma, now);

    expect(deprovision).toHaveBeenCalledWith({ provisionerInstanceId: 'prov-1', baseURL: 'https://a' });
    expect(tx.controlaiInstance.delete).toHaveBeenCalledWith({ where: { id: 'row1' } });
    expect(result).toEqual({ scanned: 1, deleted: 1, skipped: 0 });
  });
});
