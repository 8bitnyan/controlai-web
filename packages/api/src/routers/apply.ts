import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { callDaemon } from '../lib/daemon-client';
import { synthesizePlan, type DaemonState } from '../lib/apply-planner';
import { executeOp, pollReconcilerStatus } from '../lib/apply-executor';
import type { OpResult } from '@controlai-web/shared-types';

async function bindDeviceSiteRecursively(
  prisma: typeof import('@controlai-web/db').prisma,
  siteGroupId: string,
  canvasNodeId: string,
  newSiteId: string,
): Promise<string[]> {
  const root = await prisma.device.updateMany({
    where: { siteGroupId, canvasNodeId },
    data: { siteId: newSiteId },
  });
  if (root.count === 0) return [];

  const affectedKeys: string[] = [];

  const queue = (
    await prisma.device.findMany({
      where: { siteGroupId, canvasNodeId },
      select: { deviceKey: true },
    })
  ).map((d) => d.deviceKey);

  affectedKeys.push(...queue);

  while (queue.length > 0) {
    const parentDeviceKey = queue.shift();
    if (!parentDeviceKey) continue;
    const children = await prisma.device.findMany({
      where: { siteGroupId, parentDeviceKey },
      select: { deviceKey: true },
    });
    if (children.length === 0) continue;
    const childKeys = children.map((child) => child.deviceKey);
    await prisma.device.updateMany({
      where: { siteGroupId, deviceKey: { in: childKeys } },
      data: { siteId: newSiteId },
    });
    affectedKeys.push(...childKeys);
    queue.push(...childKeys);
  }

  return affectedKeys;
}

/** In-memory plan cache keyed by planId with 10-min TTL. */
const planCache = new Map<string, { plan: ReturnType<typeof synthesizePlan>; expiresAt: number }>();

const PLAN_TTL_MS = 10 * 60 * 1000;

function cachePlan(plan: ReturnType<typeof synthesizePlan>): void {
  planCache.set(plan.planId, { plan, expiresAt: Date.now() + PLAN_TTL_MS });
}

function getValidPlan(planId: string): ReturnType<typeof synthesizePlan> | null {
  const entry = planCache.get(planId);
  if (!entry || Date.now() > entry.expiresAt) {
    planCache.delete(planId);
    return null;
  }
  return entry.plan;
}

/**
 * Fetch the full daemon state (tenants + sites) and normalize Go capitalized
 * field names to camelCase. Both preview and commit MUST use this so the
 * planHash they compute is identical (otherwise commit throws "Graph changed
 * since preview").
 */
async function fetchDaemonState(
  instance: Parameters<typeof callDaemon>[0],
): Promise<DaemonState> {
  const state: DaemonState = { tenants: [], sites: [] };
  try {
    type DaemonTenantRaw = { ID?: string; id?: string; Name?: string; name?: string };
    const rawTenants = await callDaemon<DaemonTenantRaw[]>(instance, '/v1/tenants');
    state.tenants = (rawTenants ?? [])
      .map((t) => ({ id: t.ID ?? t.id ?? '', name: t.Name ?? t.name }))
      .filter((t) => t.id);

    for (const tenant of state.tenants) {
      type DaemonSiteRaw = {
        ID?: string;
        id?: string;
        BrokerKind?: string;
        Broker?: { Kind?: string; kind?: string };
        broker?: { kind?: string };
        Direction?: string;
        Ingest?: { Direction?: string; direction?: string };
        ingest?: { direction?: string };
        Throughput?: string;
        throughput?: string;
      };
      const rawSites = await callDaemon<DaemonSiteRaw[]>(
        instance,
        `/v1/tenants/${tenant.id}/sites`,
      );
      if (rawSites) {
        for (const s of rawSites) {
          const siteId = s.ID ?? s.id ?? '';
          if (!siteId) continue;
          const brokerKind =
            s.BrokerKind ?? s.Broker?.Kind ?? s.Broker?.kind ?? s.broker?.kind;
          const direction =
            s.Direction ?? s.Ingest?.Direction ?? s.Ingest?.direction ?? s.ingest?.direction;
          const throughput = s.Throughput ?? s.throughput;
          state.sites.push({
            id: siteId,
            tenantId: tenant.id,
            broker: brokerKind ? { kind: brokerKind } : undefined,
            ingest: direction ? { direction } : undefined,
            throughput,
          });
        }
      }
    }
  } catch {
    // Daemon unreachable — treat as empty state
    return { tenants: [], sites: [] };
  }
  return state;
}

export const applyRouter = router({
  /**
   * Dry-run: load active NodeConfig, fetch daemon state, synthesize plan.
   * No mutations occur.
   */
  preview: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
        include: { project: { include: { instance: true } } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      // Load the active NodeConfig, or fall back to the latest draft for first-time apply
      const nodeConfig =
        (await ctx.prisma.nodeConfig.findFirst({
          where: { siteGroupId: input.siteGroupId, isActive: true },
          orderBy: { version: 'desc' },
        })) ??
        (await ctx.prisma.nodeConfig.findFirst({
          where: { siteGroupId: input.siteGroupId },
          orderBy: { version: 'desc' },
        }));

      if (!nodeConfig) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No NodeConfig found. Design a pipeline and save before applying.',
        });
      }

      const instance = sg.project.instance;

      // Fetch current daemon state via the shared helper so preview and
      // commit compute identical planHashes.
      const daemonState = await fetchDaemonState(instance);

      const nodes = nodeConfig.nodes as unknown as Array<{ id: string; type: string; data: Record<string, unknown> }>;
      const edges = nodeConfig.edges as unknown as Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;

      const site = await ctx.prisma.site.findFirst({
        where: { siteGroupId: input.siteGroupId },
      });
      const existingSites = await ctx.prisma.site.findMany({
        where: { siteGroupId: input.siteGroupId },
        select: {
          canvasNodeId: true,
          controlaiTenantId: true,
          controlaiSiteId: true,
        },
      });
      const devices = await ctx.prisma.device.findMany({
        where: { siteGroupId: input.siteGroupId },
        select: { canvasNodeId: true, siteId: true },
      });
      const devicesByCanvasNodeId = new Map(
        devices.map((device) => [device.canvasNodeId, { siteId: device.siteId }]),
      );

      const plan = synthesizePlan(
        nodes,
        edges,
        daemonState,
        site?.controlaiTenantId ?? null,
        existingSites,
        devicesByCanvasNodeId,
      );

      cachePlan(plan);

      return plan;
    }),

  /**
   * Execute the approved plan serially against the daemon.
   */
  commit: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteGroupId: z.string().cuid(),
        planId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
        include: { project: { include: { instance: true } } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      // Retrieve cached plan
      const plan = getValidPlan(input.planId);
      if (!plan) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Plan not found or expired. Re-run preview.',
        });
      }

      // Validate plan hash hasn't changed (re-derive from active NodeConfig or latest draft)
      const nodeConfig =
        (await ctx.prisma.nodeConfig.findFirst({
          where: { siteGroupId: input.siteGroupId, isActive: true },
          orderBy: { version: 'desc' },
        })) ??
        (await ctx.prisma.nodeConfig.findFirst({
          where: { siteGroupId: input.siteGroupId },
          orderBy: { version: 'desc' },
        }));
      if (!nodeConfig) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No NodeConfig — re-run preview.',
        });
      }

      const nodes = nodeConfig.nodes as unknown as Array<{ id: string; type: string; data: Record<string, unknown> }>;
      const edges = nodeConfig.edges as unknown as Array<{ id: string; source: string; target: string }>;

      const daemonState = await fetchDaemonState(sg.project.instance);

      const site = await ctx.prisma.site.findFirst({ where: { siteGroupId: input.siteGroupId } });
      const existingSites = await ctx.prisma.site.findMany({
        where: { siteGroupId: input.siteGroupId },
        select: {
          canvasNodeId: true,
          controlaiTenantId: true,
          controlaiSiteId: true,
        },
      });
      const devices = await ctx.prisma.device.findMany({
        where: { siteGroupId: input.siteGroupId },
        select: { canvasNodeId: true, siteId: true },
      });
      const devicesByCanvasNodeId = new Map(
        devices.map((device) => [device.canvasNodeId, { siteId: device.siteId }]),
      );
      const recomputedPlan = synthesizePlan(
        nodes,
        edges,
        daemonState,
        site?.controlaiTenantId ?? null,
        existingSites,
        devicesByCanvasNodeId,
      );

      if (recomputedPlan.planHash !== plan.planHash) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Graph changed since preview — re-run preview',
        });
      }

      const instance = sg.project.instance;
      const opResults: OpResult[] = [];
      let success = true;
      let failedAt: number | null = null;

      let tenantId: string | null = site?.controlaiTenantId ?? null;
      let siteId: string | null = site?.controlaiSiteId ?? null;

      for (let i = 0; i < plan.ops.length; i++) {
        const op = plan.ops[i]!;

        opResults.push({ opId: op.id, type: op.type, status: 'running' });

        if (op.type === 'bindDeviceSite' || op.type === 'bindDeviceSiteDescendants') {
          opResults[opResults.length - 1] = { opId: op.id, type: op.type, status: 'success' };
          continue;
        }

        if (op.type === 'configureDriver') {
          // Pure DB op — persist driverId + driverConfig on the bound Site.
          const body = op.body as { driverId?: string; driverConfig?: Record<string, unknown> };
          const driverId = body.driverId ?? 'mqtt-driver';
          const driverConfig = body.driverConfig ?? {};
          try {
            // Find Site bound to this broker canvas node and update.
            const targetSite = await ctx.prisma.site.findFirst({
              where: { siteGroupId: input.siteGroupId, canvasNodeId: op.nodeId ?? undefined },
              select: { id: true },
            });
            if (targetSite) {
              await ctx.prisma.site.update({
                where: { id: targetSite.id },
                data: { driverId, driverConfig: driverConfig as never },
              });
              await writeAudit(ctx.prisma, {
                orgId: ctx.orgId,
                userId: ctx.userId ?? null,
                action: 'apply.configure-driver',
                targetId: targetSite.id,
                targetType: 'Site',
                metadata: { driverId, driverConfig },
              });
            }
            opResults[opResults.length - 1] = { opId: op.id, type: op.type, status: 'success' };
          } catch (err) {
            opResults[opResults.length - 1] = {
              opId: op.id,
              type: op.type,
              status: 'failed',
              errorDetail: err instanceof Error ? err.message : String(err),
            };
            success = false;
            failedAt = i;
            for (let j = i + 1; j < plan.ops.length; j++) {
              opResults.push({ opId: plan.ops[j]!.id, type: plan.ops[j]!.type, status: 'pending' });
            }
            break;
          }
          continue;
        }

        if (op.type === 'migrateTopicSchema') {
          const body = op.body as { mode?: string };
          const mode = body.mode;
          // Forward-only: legacy → dual → new
          if (!mode || !['dual', 'new'].includes(mode)) {
            opResults[opResults.length - 1] = {
              opId: op.id,
              type: op.type,
              status: 'failed',
              errorDetail: `Invalid topicSchemaMode for migration: ${mode}. Only 'dual' or 'new' are allowed.`,
            };
            success = false;
            failedAt = i;
            for (let j = i + 1; j < plan.ops.length; j++) {
              opResults.push({ opId: plan.ops[j]!.id, type: plan.ops[j]!.type, status: 'pending' });
            }
            break;
          }
          try {
            const sg = await ctx.prisma.siteGroup.findUnique({
              where: { id: input.siteGroupId },
              select: { topicSchemaMode: true },
            });
            const current = sg?.topicSchemaMode ?? 'legacy';
            const forwardOk =
              (current === 'legacy' && (mode === 'dual' || mode === 'new')) ||
              (current === 'dual' && mode === 'new') ||
              current === mode;
            if (!forwardOk) {
              throw new Error(
                `Topic-schema mode transitions are forward-only: ${current} -> ${mode} not allowed`,
              );
            }
            // DAEJAK guard: if 'new', refuse when any Gateway in SiteGroup has 24-hex clientId.
            if (mode === 'new') {
              const gws = await ctx.prisma.gateway.findMany({
                where: { siteGroupId: input.siteGroupId },
                select: { clientId: true },
              });
              const blocked = gws.find((g) => /^[0-9A-F]{24}$/.test(g.clientId));
              if (blocked) {
                throw new Error(
                  `Cannot move to 'new' topic schema: DAEJAK gateway present (clientId=${blocked.clientId}).`,
                );
              }
            }
            await ctx.prisma.siteGroup.update({
              where: { id: input.siteGroupId },
              data: { topicSchemaMode: mode },
            });
            await writeAudit(ctx.prisma, {
              orgId: ctx.orgId,
              userId: ctx.userId ?? null,
              action: 'apply.migrate-topic-schema',
              targetId: input.siteGroupId,
              targetType: 'SiteGroup',
              metadata: { before: current, after: mode },
            });
            opResults[opResults.length - 1] = { opId: op.id, type: op.type, status: 'success' };
          } catch (err) {
            opResults[opResults.length - 1] = {
              opId: op.id,
              type: op.type,
              status: 'failed',
              errorDetail: err instanceof Error ? err.message : String(err),
            };
            success = false;
            failedAt = i;
            for (let j = i + 1; j < plan.ops.length; j++) {
              opResults.push({ opId: plan.ops[j]!.id, type: plan.ops[j]!.type, status: 'pending' });
            }
            break;
          }
          continue;
        }

        const { result, tenantId: newTenantId, siteId: newSiteId } = await executeOp(op, instance, {
          tenantId,
          siteId,
        });

        // Replace the running entry with the actual result
        opResults[opResults.length - 1] = result;

        if (newTenantId) tenantId = newTenantId;
        if (newSiteId) siteId = newSiteId;

        if (result.status === 'failed') {
          success = false;
          failedAt = i;
          // Mark remaining ops as pending (not run)
          for (let j = i + 1; j < plan.ops.length; j++) {
            opResults.push({ opId: plan.ops[j]!.id, type: plan.ops[j]!.type, status: 'pending' });
          }
          break;
        }

        // After createSite, ensure a Postgres Site row exists for this
        // SiteGroup and stamp the daemon IDs onto it. updateMany silently
        // succeeds with 0 rows if no Site exists yet — auto-create one so
        // downstream flows (gateway.issueFromDaemon) can find it.
        if (op.type === 'createSite' && tenantId && siteId) {
          const canvasNodeId = op.nodeId;
          const existing = await ctx.prisma.site.findFirst({
            where: {
              siteGroupId: input.siteGroupId,
              canvasNodeId: canvasNodeId ?? null,
            },
          });
          if (existing) {
            await ctx.prisma.site.update({
              where: { id: existing.id },
              data: {
                controlaiTenantId: tenantId,
                controlaiSiteId: siteId,
                canvasNodeId: canvasNodeId ?? existing.canvasNodeId,
              },
            });
          } else {
            await ctx.prisma.site.create({
              data: {
                siteGroupId: input.siteGroupId,
                name: sg.name,
                canvasNodeId: canvasNodeId ?? null,
                controlaiTenantId: tenantId,
                controlaiSiteId: siteId,
              },
            });
          }

          type DaemonTenantRaw = { Domain?: string; domain?: string };
          const tenant = await callDaemon<DaemonTenantRaw>(instance, `/v1/tenants/${tenantId}`);
          const domain = (tenant.Domain ?? tenant.domain ?? '').trim();
          if (domain) {
            await ctx.prisma.site.updateMany({
              where: {
                siteGroupId: input.siteGroupId,
                canvasNodeId: canvasNodeId ?? null,
              },
              data: { tlsServername: `${siteId}.${tenantId}.${domain}` },
            });
          } else {
            console.warn(`[apply.commit] tenant domain empty; skipping site tlsServername stamp (tenant=${tenantId})`);
          }

          if (canvasNodeId) {
            const affectedDeviceKeys = await bindDeviceSiteRecursively(
              ctx.prisma,
              input.siteGroupId,
              canvasNodeId,
              siteId,
            );
            for (const deviceKey of affectedDeviceKeys) {
              void writeAudit(ctx.prisma, {
                orgId: ctx.orgId!,
                userId: ctx.userId,
                action: 'device.site-bound',
                targetId: deviceKey,
                targetType: 'Device',
                metadata: { siteId, canvasNodeId },
              });
            }
          }
        }

        // Poll reconciler after mutating ops (not issueCert — it's async anyway)
        if (op.type !== 'issueCert') {
          await pollReconcilerStatus(instance);
        }
      }

      // Mark NodeConfig as active on full success
      if (success) {
        await ctx.prisma.nodeConfig.updateMany({
          where: { siteGroupId: input.siteGroupId, isActive: true },
          data: { isActive: false },
        });
        await ctx.prisma.nodeConfig.update({
          where: { id: nodeConfig.id },
          data: { isActive: true, appliedAt: new Date(), appliedHash: plan.planHash },
        });
      }

      // Persist ApplyRun
      await ctx.prisma.applyRun.create({
        data: {
          siteGroupId: input.siteGroupId,
          planHash: plan.planHash,
          success,
          opCount: plan.ops.length,
          failedAt,
          resultJson: opResults,
        },
      });

      // Write audit log
      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'apply.commit',
        targetId: input.siteGroupId,
        targetType: 'SiteGroup',
        metadata: {
          planHash: plan.planHash,
          opCount: plan.ops.length,
          successCount: opResults.filter((r) => r.status === 'success').length,
          success,
          failedAt,
          failedOps: opResults.filter((r) => r.status === 'failed').map((r) => r.type),
        },
      });

      return {
        success,
        ops: opResults,
        planHash: plan.planHash,
      };
    }),

  /**
   * Get the most recent ApplyRun for a SiteGroup.
   */
  status: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      return ctx.prisma.applyRun.findFirst({
        where: { siteGroupId: input.siteGroupId },
        orderBy: { createdAt: 'desc' },
      });
    }),
});
