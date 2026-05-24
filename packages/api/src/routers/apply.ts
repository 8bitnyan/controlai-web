import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { callDaemon } from '../lib/daemon-client';
import { synthesizePlan, type DaemonState } from '../lib/apply-planner';
import { executeOp, pollReconcilerStatus } from '../lib/apply-executor';
import type { OpResult } from '@controlai-web/shared-types';

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

      // Fetch current daemon state. Daemon returns Go-style capitalized
      // field names (ID, Name, Broker, Ingest, …) — normalize to camelCase.
      let daemonState: DaemonState = { tenants: [], sites: [] };
      try {
        type DaemonTenantRaw = { ID?: string; id?: string; Name?: string; name?: string };
        const rawTenants = await callDaemon<DaemonTenantRaw[]>(instance, '/v1/tenants');
        daemonState.tenants = (rawTenants ?? [])
          .map((t) => ({ id: t.ID ?? t.id ?? '', name: t.Name ?? t.name }))
          .filter((t) => t.id);

        for (const tenant of daemonState.tenants) {
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
              daemonState.sites.push({
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
        // Daemon unreachable — treat as empty state (will create all resources)
        daemonState = { tenants: [], sites: [] };
      }

      const nodes = nodeConfig.nodes as unknown as Array<{ id: string; type: string; data: Record<string, unknown> }>;
      const edges = nodeConfig.edges as unknown as Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;

      const site = await ctx.prisma.site.findFirst({
        where: { siteGroupId: input.siteGroupId },
      });

      const plan = synthesizePlan(nodes, edges, daemonState, site?.controlaiTenantId ?? null);

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

      let daemonState: DaemonState = { tenants: [], sites: [] };
      try {
        const rawTenants = await callDaemon<Array<{ ID?: string; id?: string }>>(
          sg.project.instance,
          '/v1/tenants',
        );
        daemonState.tenants = (rawTenants ?? [])
          .map((t) => ({ id: t.ID ?? t.id ?? '' }))
          .filter((t) => t.id);
      } catch {
        daemonState = { tenants: [], sites: [] };
      }

      const site = await ctx.prisma.site.findFirst({ where: { siteGroupId: input.siteGroupId } });
      const recomputedPlan = synthesizePlan(nodes, edges, daemonState, site?.controlaiTenantId ?? null);

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

        // After createSite, store daemon IDs in Postgres
        if (op.type === 'createSite' && tenantId && siteId) {
          await ctx.prisma.site.updateMany({
            where: { siteGroupId: input.siteGroupId },
            data: {
              controlaiTenantId: tenantId,
              controlaiSiteId: siteId,
            },
          });
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
