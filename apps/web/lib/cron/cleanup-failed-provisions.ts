import type { PrismaClient } from '@controlai-web/db';
import { getProvisioner, writeAudit } from '@controlai-web/api';
import { DescribeTasksCommand, ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs';

export async function runCleanupTick(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ scanned: number; deleted: number; skipped: number }> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const candidates = await prisma.controlaiInstance.findMany({
    where: { status: 'PROVISION_FAILED', updatedAt: { lt: cutoff } },
    select: { id: true, orgId: true, baseURL: true, provisionerInstanceId: true, env: true },
  });

  let deleted = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.controlaiInstance.findUnique({
        where: { id: candidate.id },
        select: { status: true, provisionerInstanceId: true, baseURL: true, orgId: true, env: true },
      });

      if (!fresh || fresh.status !== 'PROVISION_FAILED') {
        return 'skipped' as const;
      }

      let deprovisionAttempted = false;

      if (fresh.provisionerInstanceId) {
        deprovisionAttempted = true;
        try {
          await getProvisioner().deprovision({
            provisionerInstanceId: fresh.provisionerInstanceId,
            baseURL: fresh.baseURL,
          });
        } catch (error) {
          console.warn('[autoCleanup] deprovision failed, continuing with row delete', error);
        }
      }

      await tx.controlaiInstance.delete({ where: { id: candidate.id } });

      void writeAudit(prisma, {
        orgId: fresh.orgId,
        action: 'instance.autoCleanup',
        targetId: candidate.id,
        targetType: 'ControlaiInstance',
        metadata: { reason: 'failed-24h', env: fresh.env, deprovisionAttempted },
      });

      return 'deleted' as const;
    });

    if (result === 'deleted') {
      deleted += 1;
    } else {
      skipped += 1;
    }
  }

  return { scanned: candidates.length, deleted, skipped };
}

export async function reconcileOrphans(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ scanned: number; deleted: number; skipped: number; errors: number }> {
  const provisioner = getProvisioner();
  if (provisioner.backend !== 'ec2') {
    return { scanned: 0, deleted: 0, skipped: 0, errors: 0 };
  }

  const ecs = new ECSClient({ region: process.env.AWS_REGION });
  const cluster = process.env.ECS_CLUSTER_NAME;
  if (!cluster) {
    return { scanned: 0, deleted: 0, skipped: 0, errors: 1 };
  }

  const byId = new Map<string, { taskArn: string; secretArn: string }>();
  let nextToken: string | undefined;
  let errors = 0;

  do {
    try {
      const listed = await ecs.send(new ListTasksCommand({ cluster, nextToken }));
      nextToken = listed.nextToken;
      const arns = listed.taskArns ?? [];
      if (arns.length === 0) continue;

      const described = await ecs.send(new DescribeTasksCommand({ cluster, tasks: arns, include: ['TAGS'] }));
      for (const task of described.tasks ?? []) {
        const taskArn = task.taskArn;
        if (!taskArn) continue;
        const instanceId = task.tags?.find((tag) => tag.key === 'controlai:instance-id')?.value;
        if (!instanceId) continue;
        byId.set(instanceId, {
          taskArn,
          secretArn: task.tags?.find((tag) => tag.key === 'controlai:secret-arn')?.value ?? '',
        });
      }
    } catch (error) {
      errors += 1;
      console.error('[orphan-reconciliation] failed to query ECS tasks', error);
      break;
    }
  } while (nextToken);

  const allRows = await prisma.controlaiInstance.findMany({
    select: { id: true, orgId: true, provisionerInstanceId: true, baseURL: true, status: true, updatedAt: true, provisionProgress: true },
  });
  const rowsByInstanceId = new Map(allRows.filter((row) => row.provisionerInstanceId).map((row) => [row.provisionerInstanceId as string, row]));

  let deleted = 0;
  let skipped = 0;
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  for (const [instanceId, taskMeta] of byId) {
    const row = rowsByInstanceId.get(instanceId);
    if (row) {
      skipped += 1;
      continue;
    }

    try {
      await provisioner.deprovision({ provisionerInstanceId: instanceId, baseURL: `https://${instanceId}.${process.env.DAEMON_BASE_DOMAIN ?? 'daemons.example.com'}` });
      deleted += 1;
      void writeAudit(prisma, {
        orgId: 'unknown',
        action: 'instance.orphanCleanup',
        targetId: instanceId,
        targetType: 'ControlaiInstance',
        metadata: { taskArn: taskMeta.taskArn, secretArn: taskMeta.secretArn, reason: 'no-db-row' },
      });
    } catch (error) {
      errors += 1;
      console.error('[orphan-reconciliation] deprovision failed', error);
    }
  }

  for (const row of allRows) {
    if (row.status !== 'PROVISIONING' || row.updatedAt >= tenMinutesAgo) continue;
    if (row.provisionerInstanceId && byId.has(row.provisionerInstanceId)) continue;
    try {
      const nextLog = [
        ...(((row as { provisionProgress?: { log?: Array<{ ts: string; message: string }> } }).provisionProgress?.log) ?? []),
        { ts: now.toISOString(), message: '[ORPHAN_RECONCILIATION] Provisioning timed out — no live ECS task' },
      ];
      await prisma.controlaiInstance.update({
        where: { id: row.id },
        data: {
          status: 'PROVISION_FAILED',
          provisionProgress: { log: nextLog },
        },
      });
      deleted += 1;
      void writeAudit(prisma, {
        orgId: row.orgId,
        action: 'instance.orphanCleanup',
        targetId: row.id,
        targetType: 'ControlaiInstance',
        metadata: { taskArn: null, secretArn: null, reason: 'stuck-provisioning' },
      });
    } catch (error) {
      errors += 1;
      console.error('[orphan-reconciliation] failed to mark stuck provisioning row', error);
    }
  }

  return { scanned: byId.size, deleted, skipped, errors };
}
