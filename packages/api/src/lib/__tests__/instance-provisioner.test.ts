import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { ECSClient, CreateServiceCommand, DeleteServiceCommand, DescribeTasksCommand, RegisterTaskDefinitionCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { CreateSecretCommand, DeleteSecretCommand, SecretsManagerClient, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { DeregisterInstanceCommand, RegisterInstanceCommand, ServiceDiscoveryClient } from '@aws-sdk/client-servicediscovery';
import { Ec2ContainerProvisioner, MockProvisioner, ProvisionerError } from '../instance-provisioner';

const ecsMock = mockClient(ECSClient);
const smMock = mockClient(SecretsManagerClient);
const sdMock = mockClient(ServiceDiscoveryClient);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
  delete process.env.INSTANCE_PROVISIONER;
  delete process.env.AWS_REGION;
  delete process.env.AWS_ACCOUNT_ID;
  delete process.env.ECS_CLUSTER_NAME;
  delete process.env.ECS_TASK_FAMILY;
  delete process.env.ECS_TASK_ROLE_ARN;
  delete process.env.ECS_EXECUTION_ROLE_ARN;
  delete process.env.ECS_SECURITY_GROUP_ID;
  delete process.env.ECS_SUBNETS;
  delete process.env.CADDY_ADMIN_ENDPOINT;
  delete process.env.SECRETS_KMS_KEY_ARN;
  delete process.env.DAEMON_BASE_DOMAIN;
  delete process.env.DAEMON_IMAGE;
  delete process.env.DAEMON_LOG_GROUP;
  delete process.env.CLOUD_MAP_NAMESPACE_ID;
  delete process.env.CLOUD_MAP_SERVICE_ID;
  ecsMock.reset();
  smMock.reset();
  sdMock.reset();
});

function setEc2Env(): void {
  process.env.AWS_REGION = 'ap-northeast-2';
  process.env.AWS_ACCOUNT_ID = '123456789012';
  process.env.ECS_CLUSTER_NAME = 'controlai-daemons';
  process.env.ECS_TASK_FAMILY = 'controlai-daemon';
  process.env.ECS_TASK_ROLE_ARN = 'arn:aws:iam::123456789012:role/task';
  process.env.ECS_EXECUTION_ROLE_ARN = 'arn:aws:iam::123456789012:role/exec';
  process.env.ECS_SECURITY_GROUP_ID = 'sg-1';
  process.env.ECS_SUBNETS = 'subnet-1,subnet-2';
  process.env.CADDY_ADMIN_ENDPOINT = 'http://caddy.daemons.local:2019';
  process.env.SECRETS_KMS_KEY_ARN = 'arn:aws:kms:ap-northeast-2:123456789012:key/1';
  process.env.DAEMON_IMAGE = '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/controlai-daemon:stable';
  process.env.DAEMON_BASE_DOMAIN = 'daemons.controlai.io';
  process.env.DAEMON_LOG_GROUP = '/aws/ecs/controlai-daemons';
  process.env.CLOUD_MAP_NAMESPACE_ID = 'ns-1';
  process.env.CLOUD_MAP_SERVICE_ID = 'srv-1';
}

describe('MockProvisioner', () => {
  it('returns expected shape', async () => {
    const mock = new MockProvisioner();
    const result = await mock.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod' });
    expect(result.bearerToken).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof result.baseURL).toBe('string');
    expect(result.ready).toBe(true);
    expect(result.provisionerInstanceId).toMatch(/^mock-/);
  });

  it('emits progress callbacks with increasing percentages', async () => {
    process.env.MOCK_PROVISIONER_FAST = '1';
    const onProgress = vi.fn();
    const mock = new MockProvisioner();
    await mock.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod', onProgress });
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(5);
    const percents = onProgress.mock.calls.map((call) => call[1] as number);
    expect(percents[0]).toBe(5);
    expect(percents[percents.length - 1]).toBe(95);
    for (let i = 1; i < percents.length; i += 1) expect(percents[i] ?? 0).toBeGreaterThanOrEqual(percents[i - 1] ?? 0);
    for (const call of onProgress.mock.calls) expect(typeof call[2]).toBe('string');
    delete process.env.MOCK_PROVISIONER_FAST;
  });
});

describe('getProvisioner', () => {
  it('selects mock when INSTANCE_PROVISIONER is unset', async () => {
    vi.resetModules();
    delete process.env.INSTANCE_PROVISIONER;
    const mod = await import('../instance-provisioner');
    expect(mod.getProvisioner().backend).toBe('mock');
  });

  it('selects mock when INSTANCE_PROVISIONER=mock', async () => {
    vi.resetModules();
    process.env.INSTANCE_PROVISIONER = 'mock';
    const mod = await import('../instance-provisioner');
    expect(mod.getProvisioner().backend).toBe('mock');
  });

  it('selects ec2 when INSTANCE_PROVISIONER=ec2', async () => {
    process.env.INSTANCE_PROVISIONER = 'ec2';
    setEc2Env();
    const mod = await import('../instance-provisioner');
    expect(mod.getProvisioner().backend).toBe('ec2');
  });
  it('throws on missing ec2 env', async () => {
    process.env.INSTANCE_PROVISIONER = 'ec2';
    setEc2Env();
    delete process.env.AWS_REGION;
    delete process.env.ECS_CLUSTER_NAME;
    delete process.env.ECS_TASK_ROLE_ARN;
    const mod = await import('../instance-provisioner');
    expect(() => mod.getProvisioner()).toThrow(/AWS_REGION|ECS_CLUSTER_NAME|ECS_TASK_ROLE_ARN/);
  });

  it('rejects fly with exact message', async () => {
    process.env.INSTANCE_PROVISIONER = 'fly';
    const mod = await import('../instance-provisioner');
    expect(() => mod.getProvisioner()).toThrow("INSTANCE_PROVISIONER=fly is no longer supported; the FlyProvisioner was removed in add-ec2-container-provisioner. Use 'mock' or 'ec2'.");
  });

  it('rejects unknown backend', async () => {
    process.env.INSTANCE_PROVISIONER = 'unknown';
    const mod = await import('../instance-provisioner');
    expect(() => mod.getProvisioner()).toThrow(/mock|ec2|unknown/);
  });
});

describe('Ec2ContainerProvisioner', () => {
  it('provision happy path', async () => {
    setEc2Env();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    smMock.on(CreateSecretCommand).resolves({ ARN: 'arn:aws:secretsmanager:ap-northeast-2:123:secret:controlai/daemon/i1/token' });
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({ taskDefinition: { taskDefinitionArn: 'arn:taskdef:1' } });
    ecsMock.on(CreateServiceCommand).resolves({ service: { serviceName: 'svc-i1' } });
    ecsMock.on(DescribeTasksCommand).resolvesOnce({ tasks: [{ taskArn: 'arn:task:1', lastStatus: 'PENDING' }] }).resolves({ tasks: [{ taskArn: 'arn:task:1', lastStatus: 'RUNNING', containers: [{ networkBindings: [{ hostPort: 49153 }] }] }] });
    sdMock.on(RegisterInstanceCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    const onProgress = vi.fn();
    const res = await p.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod', onProgress });
    expect(res.ready).toBe(true);
    expect(res.provisionerInstanceId).toBe('arn:task:1');
    const seq = onProgress.mock.calls.map((c) => [c[0], c[1]]);
    expect(seq[0]).toEqual(['creating_secret', 5]);
    expect(seq[1]).toEqual(['registering_taskdef', 15]);
    expect(seq[2]).toEqual(['creating_service', 25]);
    expect(seq.some((s) => s[0] === 'waiting_for_task' && s[1] === 40)).toBe(true);
    expect(seq.some((s) => s[0] === 'waiting_for_task' && s[1] === 75)).toBe(true);
    expect(seq.some((s) => s[0] === 'registering_dns' && s[1] === 80)).toBe(true);
    expect(seq.some((s) => s[0] === 'configuring_caddy' && s[1] === 85)).toBe(true);
    expect(res).toMatchObject({ baseURL: 'https://acme-prod.daemons.controlai.io', ready: true, provisionerInstanceId: 'arn:task:1' });
    expect(res.bearerToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps CapacityProviderException and deletes secret on fail', async () => {
    setEc2Env();
    vi.stubGlobal('fetch', vi.fn());
    smMock.on(CreateSecretCommand).resolves({});
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({ taskDefinition: { taskDefinitionArn: 'arn:taskdef:1' } });
    ecsMock.on(CreateServiceCommand).rejects(Object.assign(new Error('no capacity'), { name: 'CapacityProviderException' }));
    smMock.on(DeleteSecretCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    await expect(p.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod' })).rejects.toMatchObject({ code: 'INSUFFICIENT_CAPACITY' });
    expect(smMock.commandCalls(DeleteSecretCommand).length).toBe(1);
  });

  it('maps stopped CannotPullContainerError and cleans service + taskdef', async () => {
    setEc2Env();
    vi.stubGlobal('fetch', vi.fn());
    smMock.on(CreateSecretCommand).resolves({});
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({ taskDefinition: { taskDefinitionArn: 'arn:taskdef:1' } });
    ecsMock.on(CreateServiceCommand).resolves({});
    ecsMock.on(DescribeTasksCommand).resolves({ tasks: [{ taskArn: 'arn:task:1', lastStatus: 'STOPPED', stoppedReason: 'CannotPullContainerError: pull failed' }] });
    ecsMock.on(DeleteServiceCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    await expect(p.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod' })).rejects.toMatchObject({ code: 'IMAGE_PULL_FAILED' });
    expect(ecsMock.commandCalls(DeleteServiceCommand).length).toBe(1);
  });

  it('times out when task does not reach RUNNING in 60s', async () => {
    setEc2Env();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    smMock.on(CreateSecretCommand).resolves({});
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({ taskDefinition: { taskDefinitionArn: 'arn:taskdef:1' } });
    ecsMock.on(CreateServiceCommand).resolves({});
    ecsMock.on(DescribeTasksCommand).resolves({ tasks: [{ taskArn: 'arn:task:1', lastStatus: 'PENDING' }] });
    smMock.on(DeleteSecretCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    const run = p.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod' });
    const asserted = expect(run).rejects.toMatchObject({ code: 'TASK_FAILED_TO_START' });
    await vi.advanceTimersByTimeAsync(61_000);
    await asserted;
  });

  it('throws CADDY_ROUTE_ADD_FAILED on caddy 500', async () => {
    setEc2Env();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    smMock.on(CreateSecretCommand).resolves({});
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({ taskDefinition: { taskDefinitionArn: 'arn:taskdef:1' } });
    ecsMock.on(CreateServiceCommand).resolves({});
    ecsMock.on(DescribeTasksCommand).resolves({ tasks: [{ taskArn: 'arn:task:1', lastStatus: 'RUNNING', containers: [{ networkBindings: [{ hostPort: 49153 }] }] }] });
    sdMock.on(RegisterInstanceCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    await expect(p.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod' })).rejects.toMatchObject({ code: 'CADDY_ROUTE_ADD_FAILED' });
  });

  it('falls back to UpdateSecret on ResourceExistsException', async () => {
    setEc2Env();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    smMock.on(CreateSecretCommand).rejects(Object.assign(new Error('exists'), { name: 'ResourceExistsException' }));
    smMock.on(UpdateSecretCommand).resolves({});
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({ taskDefinition: { taskDefinitionArn: 'arn:taskdef:1' } });
    ecsMock.on(CreateServiceCommand).resolves({});
    ecsMock.on(DescribeTasksCommand).resolves({ tasks: [{ taskArn: 'arn:task:1', lastStatus: 'RUNNING', containers: [{ networkBindings: [{ hostPort: 49153 }] }] }] });
    sdMock.on(RegisterInstanceCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    await expect(p.provision({ orgId: 'org1', orgSlug: 'acme', subdomain: 'acme-prod', env: 'prod' })).resolves.toMatchObject({ provisionerInstanceId: 'arn:task:1' });
    expect(smMock.commandCalls(UpdateSecretCommand).length).toBe(1);
  });

  it('deprovision happy path calls each step once in order', async () => {
    setEc2Env();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});
    sdMock.on(DeregisterInstanceCommand).resolves({});
    smMock.on(DeleteSecretCommand).resolves({});
    const p = new Ec2ContainerProvisioner();
    await p.deprovision({ provisionerInstanceId: 'arn:task:1', baseURL: 'https://acme-prod.daemons.controlai.io' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ecsMock.commandCalls(UpdateServiceCommand).length).toBe(1);
    expect(ecsMock.commandCalls(DeleteServiceCommand).length).toBe(1);
    expect(sdMock.commandCalls(DeregisterInstanceCommand).length).toBe(1);
    expect(smMock.commandCalls(DeleteSecretCommand).length).toBe(1);
  });

  it('deprovision is idempotent for caddy 404 + secret not found', async () => {
    setEc2Env();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    ecsMock.on(UpdateServiceCommand).resolves({});
    ecsMock.on(DeleteServiceCommand).resolves({});
    sdMock.on(DeregisterInstanceCommand).resolves({});
    smMock.on(DeleteSecretCommand).rejects(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));
    const p = new Ec2ContainerProvisioner();
    await expect(p.deprovision({ provisionerInstanceId: 'arn:task:1', baseURL: 'https://acme-prod.daemons.controlai.io' })).resolves.toBeUndefined();
  });
});
