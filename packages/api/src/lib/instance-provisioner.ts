import crypto from 'node:crypto';
import { CreateServiceCommand, DeleteServiceCommand, DescribeTasksCommand, ECSClient, RegisterTaskDefinitionCommand, UpdateServiceCommand, DeregisterTaskDefinitionCommand } from '@aws-sdk/client-ecs';
import { CreateSecretCommand, DeleteSecretCommand, SecretsManagerClient, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { DeregisterInstanceCommand, RegisterInstanceCommand, ServiceDiscoveryClient } from '@aws-sdk/client-servicediscovery';

export interface ProvisionArgs { orgId: string; orgSlug: string; subdomain: string; env: 'prod' | 'staging' | 'dev'; onProgress?: (stage: string, percent: number, message: string) => void }
export interface ProvisionResult { bearerToken: string; baseURL: string; ready: boolean; provisionerInstanceId: string }
export interface DeprovisionArgs { provisionerInstanceId: string; baseURL: string }
export interface InstanceProvisioner { readonly backend: string; provision(a: ProvisionArgs): Promise<ProvisionResult>; deprovision(a: DeprovisionArgs): Promise<void> }

export class ProvisionerError extends Error {
  constructor(public readonly code: string, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ProvisionerError';
  }
}

export class MockProvisioner implements InstanceProvisioner {
  readonly backend = 'mock';
  private async maybeSleep(ms: number): Promise<void> { if (process.env.NODE_ENV === 'test' || process.env.MOCK_PROVISIONER_FAST === '1') return; await new Promise((r) => setTimeout(r, ms)); }
  async provision(a: ProvisionArgs): Promise<ProvisionResult> {
    a.onProgress?.('preparing', 5, 'Preparing mock instance'); await this.maybeSleep(200);
    a.onProgress?.('allocating', 25, 'Allocating synthetic resources'); await this.maybeSleep(400);
    a.onProgress?.('token', 50, 'Generating bearer token'); await this.maybeSleep(200);
    a.onProgress?.('dns', 75, 'Configuring DNS'); await this.maybeSleep(300);
    a.onProgress?.('finalizing', 95, 'Finalizing'); await this.maybeSleep(200);
    return { bearerToken: crypto.randomBytes(32).toString('hex'), baseURL: `https://${a.subdomain}.${process.env.DAEMON_BASE_DOMAIN ?? 'daemons.example.com'}`, ready: true, provisionerInstanceId: `mock-${crypto.randomUUID()}` };
  }
  async deprovision(_a: DeprovisionArgs): Promise<void> {}
}

export class Ec2ContainerProvisioner implements InstanceProvisioner {
  readonly backend = 'ec2';
  private readonly region: string; private readonly accountId: string; private readonly cluster: string; private readonly family: string;
  private readonly taskRoleArn: string; private readonly executionRoleArn: string; private readonly securityGroupId: string;
  private readonly subnets: string[]; private readonly caddyAdminEndpoint: string; private readonly secretsKmsKeyArn: string;
  private readonly daemonImage: string; private readonly baseDomain: string; private readonly logGroup: string;
  // Spec mismatch note: namespace id used for tagging context, service id is required for RegisterInstance.
  private readonly cloudMapNamespaceId: string; private readonly cloudMapServiceId: string;
  private ecs?: ECSClient; private sm?: SecretsManagerClient; private sd?: ServiceDiscoveryClient;
  constructor() {
    const req = ['AWS_REGION','AWS_ACCOUNT_ID','ECS_CLUSTER_NAME','ECS_TASK_FAMILY','ECS_TASK_ROLE_ARN','ECS_EXECUTION_ROLE_ARN','ECS_SECURITY_GROUP_ID','ECS_SUBNETS','CADDY_ADMIN_ENDPOINT','SECRETS_KMS_KEY_ARN','DAEMON_IMAGE','DAEMON_BASE_DOMAIN','DAEMON_LOG_GROUP','CLOUD_MAP_NAMESPACE_ID','CLOUD_MAP_SERVICE_ID'] as const;
    const miss = req.filter((k) => !process.env[k]); if (miss.length) throw new Error(`INSTANCE_PROVISIONER=ec2 requires ${miss.join(', ')}`);
    this.region = process.env.AWS_REGION!; this.accountId = process.env.AWS_ACCOUNT_ID!; this.cluster = process.env.ECS_CLUSTER_NAME!; this.family = process.env.ECS_TASK_FAMILY!;
    this.taskRoleArn = process.env.ECS_TASK_ROLE_ARN!; this.executionRoleArn = process.env.ECS_EXECUTION_ROLE_ARN!; this.securityGroupId = process.env.ECS_SECURITY_GROUP_ID!;
    this.subnets = process.env.ECS_SUBNETS!.split(',').map((v) => v.trim()).filter(Boolean); this.caddyAdminEndpoint = process.env.CADDY_ADMIN_ENDPOINT!; this.secretsKmsKeyArn = process.env.SECRETS_KMS_KEY_ARN!;
    this.daemonImage = process.env.DAEMON_IMAGE!; this.baseDomain = process.env.DAEMON_BASE_DOMAIN!; this.logGroup = process.env.DAEMON_LOG_GROUP!;
    this.cloudMapNamespaceId = process.env.CLOUD_MAP_NAMESPACE_ID!; this.cloudMapServiceId = process.env.CLOUD_MAP_SERVICE_ID!;
  }
  private getEcs() { this.ecs ??= new ECSClient({ region: this.region }); return this.ecs; }
  private getSm() { this.sm ??= new SecretsManagerClient({ region: this.region }); return this.sm; }
  private getSd() { this.sd ??= new ServiceDiscoveryClient({ region: this.region }); return this.sd; }
  private mapAwsError(err: unknown): ProvisionerError { const n = (err as { name?: string })?.name; if (n === 'CapacityProviderException') return new ProvisionerError('INSUFFICIENT_CAPACITY', 'Insufficient ECS capacity', err); if (n === 'AccessDeniedException') return new ProvisionerError('PERMISSION_DENIED', 'AWS permission denied', err); return new ProvisionerError('UNKNOWN', 'AWS operation failed', err); }
  async provision(a: ProvisionArgs): Promise<ProvisionResult> {
    const instanceId = `${a.orgSlug}-${a.env}-${crypto.randomUUID().slice(0, 8)}`; const bearerToken = crypto.randomBytes(32).toString('hex');
    const secretName = `controlai/daemon/${instanceId}/token`; const secretArn = `arn:aws:secretsmanager:${this.region}:${this.accountId}:secret:${secretName}`;
    let taskDefinitionArn = ''; let serviceName = `controlai-daemon-${instanceId}`;
    try {
      a.onProgress?.('creating_secret', 5, 'Creating daemon secret');
      try { await this.getSm().send(new CreateSecretCommand({ Name: secretName, SecretString: bearerToken, KmsKeyId: this.secretsKmsKeyArn })); }
      catch (err) { if ((err as { name?: string }).name === 'ResourceExistsException') await this.getSm().send(new UpdateSecretCommand({ SecretId: secretName, SecretString: bearerToken })); else throw err; }
      a.onProgress?.('registering_taskdef', 15, 'Registering task definition');
      const taskDef = await this.getEcs().send(new RegisterTaskDefinitionCommand({ family: this.family, networkMode: 'bridge', requiresCompatibilities: ['EC2'], cpu: '256', memory: '256', taskRoleArn: this.taskRoleArn, executionRoleArn: this.executionRoleArn, containerDefinitions: [{ name: 'daemon', image: this.daemonImage, essential: true, cpu: 256, memory: 256, portMappings: [{ containerPort: 8080, hostPort: 0, protocol: 'tcp' }], secrets: [{ name: 'DAEMON_BEARER_TOKEN', valueFrom: secretArn }], logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': this.logGroup, 'awslogs-region': this.region, 'awslogs-stream-prefix': instanceId } } }] }));
      taskDefinitionArn = taskDef.taskDefinition?.taskDefinitionArn ?? '';
      a.onProgress?.('creating_service', 25, 'Creating ECS service');
      await this.getEcs().send(new CreateServiceCommand({ cluster: this.cluster, serviceName, taskDefinition: taskDefinitionArn, desiredCount: 1, launchType: 'EC2', capacityProviderStrategy: [{ capacityProvider: 'controlai-daemons-cp', weight: 1 }], placementStrategy: [{ type: 'binpack', field: 'memory' }] }));
      let taskArn = ''; const deadline = Date.now() + 60_000; let i = 0;
      while (Date.now() < deadline) {
        const p = i === 0 ? 40 : 75; a.onProgress?.('waiting_for_task', p, 'Waiting for ECS task to start'); i += 1;
        const d = await this.getEcs().send(new DescribeTasksCommand({ cluster: this.cluster, tasks: taskArn ? [taskArn] : undefined }));
        const t = d.tasks?.[0]; if (!t) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        taskArn = t.taskArn ?? taskArn;
        if (t.lastStatus === 'RUNNING') { a.onProgress?.('waiting_for_task', 75, 'Task is running'); break; }
        if (t.lastStatus === 'STOPPED') {
          if ((t.stoppedReason ?? '').includes('CannotPullContainerError')) throw new ProvisionerError('IMAGE_PULL_FAILED', t.stoppedReason ?? 'Image pull failed', t.stoppedReason);
          throw new ProvisionerError('TASK_FAILED_TO_START', t.stoppedReason ?? 'Task stopped before running', t.stoppedReason);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      const finalTask = await this.getEcs().send(new DescribeTasksCommand({ cluster: this.cluster, tasks: taskArn ? [taskArn] : undefined }));
      if (!taskArn || finalTask.tasks?.[0]?.lastStatus !== 'RUNNING') throw new ProvisionerError('TASK_FAILED_TO_START', 'Task failed to start within 60s');
      a.onProgress?.('registering_dns', 80, 'Registering Cloud Map instance');
      await this.getSd().send(new RegisterInstanceCommand({ ServiceId: this.cloudMapServiceId, InstanceId: instanceId, Attributes: { AWS_INSTANCE_PORT: '8080', AWS_INSTANCE_IPV4: '127.0.0.1', 'controlai:namespace-id': this.cloudMapNamespaceId } }));
      a.onProgress?.('configuring_caddy', 85, 'Configuring Caddy route');
      const res = await fetch(`${this.caddyAdminEndpoint}/config/apps/http/servers/srv0/routes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: `${a.subdomain}.${this.baseDomain}`, upstream: `${instanceId}.daemons.local` }) });
      if (!res.ok) throw new ProvisionerError('CADDY_ROUTE_ADD_FAILED', `Caddy route add failed: ${res.status}`);
      return { bearerToken, baseURL: `https://${a.subdomain}.${this.baseDomain}`, ready: true, provisionerInstanceId: taskArn };
    } catch (err) {
      try { await this.getSm().send(new DeleteSecretCommand({ SecretId: secretName, ForceDeleteWithoutRecovery: true })); } catch {}
      if (serviceName) { try { await this.getEcs().send(new DeleteServiceCommand({ cluster: this.cluster, service: serviceName, force: true })); } catch {} }
      if (taskDefinitionArn) { try { await this.getEcs().send(new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefinitionArn })); } catch {} }
      if (err instanceof ProvisionerError) throw err;
      throw this.mapAwsError(err);
    }
  }
  async deprovision(a: DeprovisionArgs): Promise<void> {
    const id = new URL(a.baseURL).hostname.split('.')[0] ?? '';
    const caddyRes = await fetch(`${this.caddyAdminEndpoint}/config/apps/http/servers/srv0/routes/${id}`, { method: 'DELETE' });
    if (!caddyRes.ok && caddyRes.status !== 404) throw new ProvisionerError('DEPROVISION_FAILED', `Caddy route delete failed: ${caddyRes.status}`);
    await this.getEcs().send(new UpdateServiceCommand({ cluster: this.cluster, service: `controlai-daemon-${id}`, desiredCount: 0 }));
    await this.getEcs().send(new DeleteServiceCommand({ cluster: this.cluster, service: `controlai-daemon-${id}`, force: true }));
    await this.getSd().send(new DeregisterInstanceCommand({ ServiceId: this.cloudMapServiceId, InstanceId: id }));
    try { await this.getSm().send(new DeleteSecretCommand({ SecretId: `controlai/daemon/${id}/token`, ForceDeleteWithoutRecovery: true })); } catch (err) { if ((err as { name?: string }).name !== 'ResourceNotFoundException') throw new ProvisionerError('DEPROVISION_FAILED', 'Secret delete failed', err); }
  }
}

let cached: InstanceProvisioner | null = null;
export function getProvisioner(): InstanceProvisioner {
  if (cached) return cached;
  const selected = process.env.INSTANCE_PROVISIONER;
  if (selected === undefined || selected === 'mock') return (cached = new MockProvisioner());
  if (selected === 'ec2') return (cached = new Ec2ContainerProvisioner());
  if (selected === 'fly') throw new Error("INSTANCE_PROVISIONER=fly is no longer supported; the FlyProvisioner was removed in add-ec2-container-provisioner. Use 'mock' or 'ec2'.");
  throw new Error(`Unsupported INSTANCE_PROVISIONER='${selected}'. Supported values: 'mock', 'ec2'.`);
}
