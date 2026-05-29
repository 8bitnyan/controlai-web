import type { PrismaClient } from '@controlai-web/db';
import { writeAudit } from './audit-writer';
import { encryptToken } from './crypto';
import { checkDaemonHealth } from './daemon-client';
import { getProvisioner, ProvisionerError } from './instance-provisioner';
import { updateProvisionProgress } from './provision-progress';

export interface ProvisionTaskArgs {
  orgId: string;
  orgSlug: string;
  subdomain: string;
  env: 'prod' | 'staging' | 'dev';
  baseURL: string;
}

const pending = new Map<string, Promise<void>>();
export function __getPendingForTest(instanceId: string) {
  return pending.get(instanceId);
}

export function provisionTask(prisma: PrismaClient, instanceId: string, args: ProvisionTaskArgs): Promise<void> {
  const p = (async () => {
    const provisioner = getProvisioner();
    let result: Awaited<ReturnType<typeof provisioner.provision>> | undefined;
    await updateProvisionProgress(prisma, instanceId, { stage: 'starting', percent: 0, message: 'Provisioning started' });
    try {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ProvisionerError('MACHINE_START_TIMEOUT', 'Provision SLA exceeded (90s budget)'));
        }, 90_000);
      });
      try {
        result = await Promise.race([
          provisioner.provision({
            orgId: args.orgId,
            orgSlug: args.orgSlug,
            subdomain: args.subdomain,
            env: args.env,
            onProgress: (stage, percent, message) => {
              void updateProvisionProgress(prisma, instanceId, { stage, percent, message });
            },
          }),
          timeoutPromise,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      let version: string | null = null;
      if (provisioner.backend === 'mock') {
        // Mock provisioner returns a fake baseURL — there is no real daemon to hit.
        await updateProvisionProgress(prisma, instanceId, { stage: 'verifying_health', percent: 95, message: 'Mock provisioner — skipping live health check' });
        version = 'mock-0.0.0';
      } else {
        await updateProvisionProgress(prisma, instanceId, { stage: 'verifying_health', percent: 95, message: 'Verifying daemon health' });
        try {
          const health = await checkDaemonHealth(result.baseURL, result.bearerToken);
          version = health.version ?? null;
        } catch (e) {
          throw new ProvisionerError('POST_PROVISION_HEALTHCHECK_FAILED', e instanceof Error ? e.message : String(e), e);
        }
      }
      await prisma.controlaiInstance.update({
        where: { id: instanceId },
        data: {
          status: 'HEALTHY',
          bearerTokenEnc: encryptToken(result.bearerToken),
          provisionerInstanceId: result.provisionerInstanceId,
          version,
          lastSeenAt: new Date(),
        },
      });
      await updateProvisionProgress(prisma, instanceId, { stage: 'done', percent: 100, message: 'Provisioning complete' });
      void writeAudit(prisma, {
        orgId: args.orgId,
        action: 'instance.provision',
        targetId: instanceId,
        targetType: 'ControlaiInstance',
        metadata: provisioner.backend === 'ec2'
          ? {
              env: args.env,
              baseURL: args.baseURL,
              provisionerBackend: provisioner.backend,
              awsRegion: process.env.AWS_REGION,
              taskArn: result.provisionerInstanceId,
              secretArn: `arn:aws:secretsmanager:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:secret:controlai/daemon/${instanceId}/token`,
            }
          : { env: args.env, baseURL: args.baseURL, provisionerBackend: provisioner.backend },
      });
    } catch (err) {
      const code = err instanceof ProvisionerError ? err.code : 'UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      await prisma.controlaiInstance.update({ where: { id: instanceId }, data: { status: 'PROVISION_FAILED' } }).catch(() => {});
      await updateProvisionProgress(prisma, instanceId, { stage: 'failed', percent: 0, message: `Provisioning failed [${code}]: ${message}` });
      console.error('[provision-task] failed', { instanceId, code, message, cause: err });
      void writeAudit(prisma, {
        orgId: args.orgId,
        action: 'instance.provisionFailed',
        targetId: instanceId,
        targetType: 'ControlaiInstance',
        metadata: provisioner.backend === 'ec2'
          ? {
              env: args.env,
              error: { code, message },
              provisionerBackend: provisioner.backend,
              awsRegion: process.env.AWS_REGION,
              taskArn: result?.provisionerInstanceId,
            }
          : { env: args.env, error: { code, message }, provisionerBackend: provisioner.backend },
      });
    } finally {
      pending.delete(instanceId);
    }
  })();
  pending.set(instanceId, p);
  return p;
}
