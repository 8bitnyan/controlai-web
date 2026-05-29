import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deprovision, writeAudit, ecsSend, backend } = vi.hoisted(() => ({
  deprovision: vi.fn(),
  writeAudit: vi.fn(),
  ecsSend: vi.fn(),
  backend: { current: 'ec2' as 'ec2' | 'mock' },
}));

vi.mock('@controlai-web/api', () => ({
  getProvisioner: () => ({ backend: backend.current, deprovision }),
  writeAudit,
}));

vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: class {
    send = ecsSend;
  },
  ListTasksCommand: class { constructor(public readonly input: unknown) {} },
  DescribeTasksCommand: class { constructor(public readonly input: unknown) {} },
}));

describe('reconcileOrphans', () => {
  beforeEach(() => {
    backend.current = 'ec2';
    deprovision.mockReset();
    writeAudit.mockReset();
    ecsSend.mockReset();
    process.env.AWS_REGION = 'ap-northeast-2';
    process.env.ECS_CLUSTER_NAME = 'controlai-daemons';
    process.env.DAEMON_BASE_DOMAIN = 'daemons.controlai.io';
  });

  it('returns all-zero counts when ECS list and DB rows match', async () => {
    const { reconcileOrphans } = await import('../cleanup-failed-provisions');
    ecsSend.mockResolvedValueOnce({ taskArns: ['arn:1'] }).mockResolvedValueOnce({ tasks: [{ taskArn: 'arn:1', tags: [{ key: 'controlai:instance-id', value: 'abc' }] }] });
    const prisma: any = { controlaiInstance: { findMany: vi.fn().mockResolvedValue([{ id: 'i1', provisionerInstanceId: 'abc', status: 'HEALTHY', updatedAt: new Date(), orgId: 'o1' }]) } };
    const result = await reconcileOrphans(prisma, new Date());
    expect(result).toEqual({ scanned: 1, deleted: 0, skipped: 1, errors: 0 });
  });

  it('deprovisions ecs task with no db row and writes orphan cleanup audit', async () => {
    const { reconcileOrphans } = await import('../cleanup-failed-provisions');
    ecsSend.mockResolvedValueOnce({ taskArns: ['arn:1'] }).mockResolvedValueOnce({ tasks: [{ taskArn: 'arn:1', tags: [{ key: 'controlai:instance-id', value: 'abc' }, { key: 'controlai:secret-arn', value: 'sec-1' }] }] });
    const prisma: any = { controlaiInstance: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await reconcileOrphans(prisma, new Date());
    expect(deprovision).toHaveBeenCalledWith({ provisionerInstanceId: 'abc', baseURL: 'https://abc.daemons.controlai.io' });
    expect(writeAudit).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'instance.orphanCleanup', metadata: { taskArn: 'arn:1', secretArn: 'sec-1', reason: 'no-db-row' } }));
    expect(result).toEqual({ scanned: 1, deleted: 1, skipped: 0, errors: 0 });
  });

  it('marks stuck provisioning row as failed and audits stuck-provisioning reason', async () => {
    const { reconcileOrphans } = await import('../cleanup-failed-provisions');
    ecsSend.mockResolvedValueOnce({ taskArns: [] });
    const prisma: any = {
      controlaiInstance: {
        findMany: vi.fn().mockResolvedValue([{ id: 'i1', orgId: 'o1', provisionerInstanceId: 'abc', baseURL: 'https://abc.daemons.controlai.io', status: 'PROVISIONING', updatedAt: new Date('2026-05-28T00:00:00.000Z') }]),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const result = await reconcileOrphans(prisma, new Date('2026-05-28T00:20:00.000Z'));
    expect(prisma.controlaiInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROVISION_FAILED' }) }));
    expect(writeAudit).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'instance.orphanCleanup', metadata: { taskArn: null, secretArn: null, reason: 'stuck-provisioning' } }));
    expect(result).toEqual({ scanned: 0, deleted: 1, skipped: 0, errors: 0 });
  });

  it('returns early with no aws calls when backend is mock', async () => {
    const { reconcileOrphans } = await import('../cleanup-failed-provisions');
    backend.current = 'mock';
    const prisma: any = { controlaiInstance: { findMany: vi.fn() } };
    const result = await reconcileOrphans(prisma, new Date());
    expect(result).toEqual({ scanned: 0, deleted: 0, skipped: 0, errors: 0 });
    expect(ecsSend).not.toHaveBeenCalled();
  });

  it('increments errors and does not throw on aws throttling exception', async () => {
    const { reconcileOrphans } = await import('../cleanup-failed-provisions');
    const error = Object.assign(new Error('throttle'), { name: 'ThrottlingException' });
    ecsSend.mockImplementationOnce(() => {
      throw error;
    });
    const prisma: any = { controlaiInstance: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await reconcileOrphans(prisma, new Date());
    expect(result).toEqual({ scanned: 0, deleted: 0, skipped: 0, errors: 1 });
  });
});
