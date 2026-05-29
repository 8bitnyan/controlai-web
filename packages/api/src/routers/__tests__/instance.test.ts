import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '../../root';
import { writeAudit } from '../../lib/audit-writer';
import { getProvisioner } from '../../lib/instance-provisioner';
import { checkDaemonHealth } from '../../lib/daemon-client';
import { __getPendingForTest } from '../../lib/provision-task';

vi.mock('../../lib/audit-writer', () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/instance-provisioner', () => ({ getProvisioner: vi.fn(), ProvisionerError: class ProvisionerError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'ProvisionerError'; } } }));
vi.mock('../../lib/daemon-client', () => ({ checkDaemonHealth: vi.fn() }));

const ORG_ID = 'cmorg000000000000000000001';

function makePrisma(role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER') {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue({ id: ORG_ID, slug: 'acme' }) },
    organizationMember: { findUnique: vi.fn().mockResolvedValue({ role }) },
    controlaiInstance: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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

describe('instance router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTANCE_TOKEN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.DAEMON_BASE_DOMAIN = 'daemons.controlai.io';
  });

  it('provision happy path -> async reaches HEALTHY + audit', async () => {
    const p = makePrisma();
    p.controlaiInstance.findFirst.mockResolvedValue(null);
    p.controlaiInstance.create.mockResolvedValue({ id: 'cminst1' });
    p.controlaiInstance.update.mockResolvedValue({});
    vi.mocked(getProvisioner).mockReturnValue({ backend: 'mock', provision: vi.fn().mockResolvedValue({ bearerToken: 'real-token', baseURL: 'https://acme-prod.daemons.controlai.io', ready: true, provisionerInstanceId: 'm1' }), deprovision: vi.fn() });
    vi.mocked(checkDaemonHealth).mockResolvedValue({ status: 'healthy', version: '1.2.3' });

    await expect(makeCaller(p).instance.provision({ orgId: ORG_ID, name: 'Managed', env: 'prod' })).resolves.toEqual({ id: 'cminst1' });
    await __getPendingForTest('cminst1');
    expect(p.controlaiInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'HEALTHY', provisionerInstanceId: 'm1' }) }));
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'instance.provision' }));
  });

  it('provision collision -> CONFLICT', async () => {
    const p = makePrisma();
    p.controlaiInstance.findFirst.mockResolvedValue({ id: 'existing1', env: 'prod' });
    await expect(makeCaller(p).instance.provision({ orgId: ORG_ID, name: 'Managed', env: 'prod' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(p.controlaiInstance.create).not.toHaveBeenCalled();
  });

  it('provisioner throws -> PROVISION_FAILED + failure audit', async () => {
    const p = makePrisma();
    p.controlaiInstance.findFirst.mockResolvedValue(null);
    p.controlaiInstance.create.mockResolvedValue({ id: 'cminst2' });
    p.controlaiInstance.update.mockResolvedValue({});
    vi.mocked(getProvisioner).mockReturnValue({ backend: 'mock', provision: vi.fn().mockRejectedValue(new Error('boom')), deprovision: vi.fn() });
    await makeCaller(p).instance.provision({ orgId: ORG_ID, name: 'Managed', env: 'staging' });
    await __getPendingForTest('cminst2');
    expect(p.controlaiInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PROVISION_FAILED' } }));
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'instance.provisionFailed' }));
  });

  it('retryProvision: failed -> PROVISIONING', async () => {
    const p = makePrisma();
    p.controlaiInstance.findFirst.mockResolvedValue({ id: 'cminst000000000000000000003', orgId: ORG_ID, env: 'prod', status: 'PROVISION_FAILED', baseURL: 'https://acme-prod.daemons.controlai.io' });
    p.controlaiInstance.update.mockResolvedValue({});
    vi.mocked(getProvisioner).mockReturnValue({ backend: 'mock', provision: vi.fn().mockResolvedValue({ bearerToken: 't', baseURL: 'https://acme-prod.daemons.controlai.io', ready: true, provisionerInstanceId: 'm3' }), deprovision: vi.fn() });
    vi.mocked(checkDaemonHealth).mockResolvedValue({ status: 'healthy', version: '1.0.0' });
    await expect(makeCaller(p).instance.retryProvision({ orgId: ORG_ID, instanceId: 'cmiiiiiiiiiiiiiiiiiiiiii3' })).resolves.toEqual({ id: 'cminst000000000000000000003' });
    expect(p.controlaiInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROVISIONING' }) }));
  });

  it('retryProvision rejects BYO and HEALTHY', async () => {
    const p = makePrisma();
    p.controlaiInstance.findFirst.mockResolvedValueOnce({ id: 'cminst4', orgId: ORG_ID, env: null, status: 'PROVISION_FAILED', baseURL: 'https://x' });
    await expect(makeCaller(p).instance.retryProvision({ orgId: ORG_ID, instanceId: 'cminst4' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    p.controlaiInstance.findFirst.mockResolvedValueOnce({ id: 'cminst5', orgId: ORG_ID, env: 'prod', status: 'HEALTHY', baseURL: 'https://x' });
    await expect(makeCaller(p).instance.retryProvision({ orgId: ORG_ID, instanceId: 'cminst5' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('deprovision blocked by dependent projects', async () => {
    const p = makePrisma();
    p.controlaiInstance.findFirst.mockResolvedValue({ id: 'cminst000000000000000000006', orgId: ORG_ID, baseURL: 'https://x', provisionerInstanceId: 'm1', env: 'prod', projects: [{ name: 'p1' }, { name: 'p2' }] });
    await expect(makeCaller(p).instance.deprovision({ orgId: ORG_ID, instanceId: 'cmiiiiiiiiiiiiiiiiiiiiii6' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('deprovision happy -> backend deprovision + delete + audit', async () => {
    const p = makePrisma('OWNER');
    const deprovision = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getProvisioner).mockReturnValue({ backend: 'mock', provision: vi.fn(), deprovision });
    p.controlaiInstance.findFirst.mockResolvedValue({ id: 'cminst000000000000000000007', orgId: ORG_ID, baseURL: 'https://x', provisionerInstanceId: 'm1', env: 'prod', projects: [] });
    p.controlaiInstance.delete.mockResolvedValue({});
    await expect(makeCaller(p).instance.deprovision({ orgId: ORG_ID, instanceId: 'cmiiiiiiiiiiiiiiiiiiiiii7' })).resolves.toEqual({ success: true });
    expect(deprovision).toHaveBeenCalledOnce();
    expect(p.controlaiInstance.delete).toHaveBeenCalledOnce();
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'instance.deprovision' }));
  });

  it('deprovision writes ec2 audit metadata', async () => {
    const p = makePrisma('OWNER');
    process.env.AWS_REGION = 'ap-northeast-2';
    const deprovision = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getProvisioner).mockReturnValue({ backend: 'ec2', provision: vi.fn(), deprovision });
    p.controlaiInstance.findFirst.mockResolvedValue({ id: 'cminst-ec2', orgId: ORG_ID, baseURL: 'https://x', provisionerInstanceId: 'arn:aws:ecs:ap-northeast-2:1:task/t1', env: 'prod', projects: [] });
    p.controlaiInstance.delete.mockResolvedValue({});

    await expect(makeCaller(p).instance.deprovision({ orgId: ORG_ID, instanceId: 'cmiiiiiiiiiiiiiiiiiiiiii8' })).resolves.toEqual({ success: true });

    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'instance.deprovision',
      metadata: expect.objectContaining({
        provisionerBackend: 'ec2',
        awsRegion: 'ap-northeast-2',
        taskArn: 'arn:aws:ecs:ap-northeast-2:1:task/t1',
      }),
    }));
  });

  it('non-admin caller blocked by middleware on provision', async () => {
    const p = makePrisma('MEMBER');
    await expect(makeCaller(p).instance.provision({ orgId: ORG_ID, name: 'Managed', env: 'dev' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bootstrapDefault creates then becomes idempotent', async () => {
    const p = makePrisma('OWNER');
    process.env.DEFAULT_DAEMON_BASE_URL = 'https://default.daemons.controlai.io';
    process.env.DEFAULT_DAEMON_BEARER_TOKEN = 'default-token';
    p.controlaiInstance.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing-default', orgId: ORG_ID, legacy: false });
    p.controlaiInstance.create.mockResolvedValue({ id: 'created-default', orgId: ORG_ID, legacy: false });

    await expect(makeCaller(p).instance.bootstrapDefault({ orgId: ORG_ID })).resolves.toMatchObject({ id: 'created-default' });
    await expect(makeCaller(p).instance.bootstrapDefault({ orgId: ORG_ID })).resolves.toMatchObject({ id: 'existing-default' });
    expect(p.controlaiInstance.create).toHaveBeenCalledTimes(1);
  });

  it('bootstrapDefault throws on missing env vars', async () => {
    const p = makePrisma('OWNER');
    delete process.env.DEFAULT_DAEMON_BASE_URL;
    process.env.DEFAULT_DAEMON_BEARER_TOKEN = 'x';
    await expect(makeCaller(p).instance.bootstrapDefault({ orgId: ORG_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    process.env.DEFAULT_DAEMON_BASE_URL = 'https://default.daemons.controlai.io';
    delete process.env.DEFAULT_DAEMON_BEARER_TOKEN;
    await expect(makeCaller(p).instance.bootstrapDefault({ orgId: ORG_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
