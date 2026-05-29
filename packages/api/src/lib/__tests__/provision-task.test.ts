import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAudit } from '../audit-writer';
import { checkDaemonHealth } from '../daemon-client';
import * as provisionerModule from '../instance-provisioner';
import { provisionTask } from '../provision-task';

vi.mock('../audit-writer', () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../daemon-client', () => ({ checkDaemonHealth: vi.fn() }));

function makePrisma() {
  return {
    controlaiInstance: { update: vi.fn().mockResolvedValue({}) },
  } as any;
}

describe('provision-task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTANCE_TOKEN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('marks failed on 90s SLA timeout', async () => {
    vi.useFakeTimers();
    const p = makePrisma();
    vi.spyOn(provisionerModule, 'getProvisioner').mockReturnValue({
      backend: 'ec2',
      provision: vi.fn(() => new Promise<provisionerModule.ProvisionResult>(() => {})),
      deprovision: vi.fn(),
    });

    const run = provisionTask(p, 'inst-timeout', { orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod', baseURL: 'https://x' });
    await vi.advanceTimersByTimeAsync(90_000);
    await run;

    expect(p.controlaiInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PROVISION_FAILED' } }));
    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'instance.provisionFailed',
      metadata: expect.objectContaining({ error: { code: 'MACHINE_START_TIMEOUT', message: 'Provision SLA exceeded (90s budget)' } }),
    }));
    vi.useRealTimers();
  });

  it('adds ec2 metadata to provision success audit', async () => {
    const p = makePrisma();
    process.env.AWS_REGION = 'ap-northeast-2';
    process.env.AWS_ACCOUNT_ID = '123456789012';
    vi.spyOn(provisionerModule, 'getProvisioner').mockReturnValue({
      backend: 'ec2',
      provision: vi.fn().mockResolvedValue({
        bearerToken: 'token',
        baseURL: 'https://acme-prod.daemons.controlai.io',
        ready: true,
        provisionerInstanceId: 'arn:aws:ecs:ap-northeast-2:123456789012:task/t1',
      }),
      deprovision: vi.fn(),
    });
    vi.mocked(checkDaemonHealth).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await provisionTask(p, 'inst-1', { orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod', baseURL: 'https://acme-prod.daemons.controlai.io' });

    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'instance.provision',
      metadata: expect.objectContaining({
        awsRegion: 'ap-northeast-2',
        taskArn: 'arn:aws:ecs:ap-northeast-2:123456789012:task/t1',
        secretArn: 'arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:controlai/daemon/inst-1/token',
      }),
    }));
  });
});
