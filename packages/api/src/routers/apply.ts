import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { callDaemon } from '../lib/daemon-client';
import { synthesizePlan, type DaemonState } from '../lib/apply-planner';
import { executeOp, pollReconcilerStatus } from '../lib/apply-executor';
import type { OpResult } from '@controlai-web/shared-types';
import { getDeviceType } from '@controlai-web/shared-types';

const INFRA_CATEGORIES = new Set(['broker', 'ingest', 'tsdb', 'monitoring']);
function isInfraDeviceType(deviceTypeId: string | null | undefined): boolean {
  if (!deviceTypeId) return false;
  const m = getDeviceType(deviceTypeId);
  return !!m && INFRA_CATEGORIES.has(m.category);
}
import { encryptToken } from '../lib/crypto';
import type { Prisma } from '@controlai-web/db';

type ApplyGraphNode = { id: string; type: string; data: Record<string, unknown> };
type ApplyGraphEdge = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string };

function inferGatewayLabel(node: ApplyGraphNode): string {
  const label = node.data?.label;
  if (typeof label === 'string' && label.trim().length > 0) return label.trim();
  return 'gateway';
}

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

  // Infra devices (broker/ingest/tsdb/monitoring) are considered REGISTERED
  // as soon as Apply binds them to a Site — there is no physical board to provision.
  const rootDevices = await prisma.device.findMany({
    where: { siteGroupId, canvasNodeId },
    select: { deviceKey: true, deviceTypeId: true, registrationState: true },
  });
  const rootInfraKeys = rootDevices
    .filter((d) => d.registrationState !== 'REGISTERED' && isInfraDeviceType(d.deviceTypeId))
    .map((d) => d.deviceKey);
  if (rootInfraKeys.length > 0) {
    await prisma.device.updateMany({
      where: { deviceKey: { in: rootInfraKeys } },
      data: { registrationState: 'REGISTERED', registeredAt: new Date() },
    });
  }

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
    const childRows = await prisma.device.findMany({
      where: { deviceKey: { in: childKeys } },
      select: { deviceKey: true, deviceTypeId: true, registrationState: true },
    });
    const infraChildKeys = childRows
      .filter((d) => d.registrationState !== 'REGISTERED' && isInfraDeviceType(d.deviceTypeId))
      .map((d) => d.deviceKey);
    if (infraChildKeys.length > 0) {
      await prisma.device.updateMany({
        where: { deviceKey: { in: infraChildKeys } },
        data: { registrationState: 'REGISTERED', registeredAt: new Date() },
      });
    }
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

      const nodes = nodeConfig.nodes as unknown as ApplyGraphNode[];
      const edges = nodeConfig.edges as unknown as ApplyGraphEdge[];

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

      const nodes = nodeConfig.nodes as unknown as ApplyGraphNode[];
      const edges = nodeConfig.edges as unknown as ApplyGraphEdge[];

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
        if (op.type === 'createSite') {
          if (!tenantId || !siteId) {
            console.warn('[apply.commit] createSite succeeded but tenantId/siteId unresolved', {
              opId: op.id,
              tenantId,
              siteId,
              daemonResponseBody: result.daemonResponseBody,
            });
            continue;
          }
          const canvasNodeId = op.nodeId;
          try {
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
          } catch (err) {
            console.warn('[apply.commit] site upsert failed', { opId: op.id, error: err });
            opResults[opResults.length - 1] = {
              ...result,
              status: 'failed',
              errorDetail: `site upsert failed: ${err instanceof Error ? err.message : String(err)}`,
            };
            success = false;
            failedAt = i;
            for (let j = i + 1; j < plan.ops.length; j++) {
              opResults.push({ opId: plan.ops[j]!.id, type: plan.ops[j]!.type, status: 'pending' });
            }
            break;
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

        if (op.type === 'issueCert' && tenantId && siteId && result.daemonResponseBody) {
          const body = result.daemonResponseBody as Record<string, unknown>;
          const cert = typeof body.cert_pem === 'string' ? body.cert_pem : typeof body.clientCertPem === 'string' ? body.clientCertPem : null;
          const key = typeof body.key_pem === 'string' ? body.key_pem : typeof body.clientKeyPem === 'string' ? body.clientKeyPem : null;
          const ca = typeof body.ca_pem === 'string' ? body.ca_pem : typeof body.rootCaPem === 'string' ? body.rootCaPem : null;
          if (cert && key) {
            await ctx.prisma.site.updateMany({
              where: { siteGroupId: input.siteGroupId, controlaiTenantId: tenantId, controlaiSiteId: siteId },
              data: { mqttCert: encryptToken(cert), mqttKey: encryptToken(key) },
            });
          }
          if (!cert || !key) {
            // No cert material to provision gateways with; skip auto-create.
          } else {
          const certPem: string = cert;
          const keyPem: string = key;
          // Do NOT fall back to cert as the CA — embedded TLS clients (board
          // firmware) need the actual issuer CA to verify the server cert.
          // If the daemon's issueCert response omits ca_pem, skip the auto-
          // create entirely so we don't poison the Gateway row with a wrong CA.
          if (!ca) {
            console.warn('[apply.commit] issueCert response missing ca_pem; skipping gateway auto-create to avoid poisoning rootCa', { tenantId, siteId });
          }
          const caPem: string | null = ca;
          const gatewayNodes = nodes.filter((node) => String(node.data?.deviceTypeId ?? '').includes('gateway'));
          const sites = await ctx.prisma.site.findMany({ where: { siteGroupId: input.siteGroupId } });
          const siteByCanvasNode = new Map(sites.map((s) => [s.canvasNodeId, s]));
          const domain = (new URL(instance.baseURL)).hostname;
          for (const gatewayNode of gatewayNodes) {
            const relatedEdge = edges.find((edge) => edge.source === gatewayNode.id || edge.target === gatewayNode.id);
            if (!relatedEdge) continue;
            const brokerNodeId = relatedEdge.source === gatewayNode.id ? relatedEdge.target : relatedEdge.source;
            const boundSite = siteByCanvasNode.get(brokerNodeId);
            if (!boundSite?.controlaiSiteId || !boundSite.controlaiTenantId) continue;
            const endpointHost = boundSite.tlsServername ?? `${boundSite.controlaiSiteId}.${boundSite.controlaiTenantId}.${domain}`;
            const gatewayDeviceRow = await ctx.prisma.device.findFirst({
              where: { siteGroupId: input.siteGroupId, canvasNodeId: gatewayNode.id },
              select: { deviceKey: true },
            });
            if (!caPem) {
              // Skip — see warning above; we refuse to write a Gateway row with a
              // missing/poisoned CA because it breaks board TLS handshake.
              continue;
            }
            const gatewayData = {
              label: inferGatewayLabel(gatewayNode),
              kind: 'simulator',
              mode: 'cbor-modules-cloud',
              endpointURL: `mqtts://${endpointHost}:8883`,
              groupId: boundSite.controlaiTenantId,
              clientId: `gw-${gatewayNode.id.slice(0, 8)}`,
              rootCaPemEnc: encryptToken(caPem),
              clientCertPemEnc: encryptToken(certPem),
              clientKeyPemEnc: encryptToken(keyPem),
              sensors: [],
              desiredState: 'running',
              simulationDesired: true,
              ...(gatewayDeviceRow?.deviceKey ? { deviceKey: gatewayDeviceRow.deviceKey } : {}),
            };
            const existingGateway = await ctx.prisma.gateway.findFirst({
              where: { siteGroupId: input.siteGroupId, canvasNodeId: gatewayNode.id },
              select: { id: true },
            });
            if (existingGateway) {
              await ctx.prisma.gateway.update({ where: { id: existingGateway.id }, data: gatewayData });
            } else {
              await ctx.prisma.gateway.create({ data: { siteGroupId: input.siteGroupId, canvasNodeId: gatewayNode.id, ...gatewayData } });
            }
          }
          }
        }

        // Poll reconciler after mutating ops (not issueCert — it's async anyway)
        if (op.type !== 'issueCert') {
          await pollReconcilerStatus(instance);
        }
      }

      // Post-loop: ensure every gateway canvas node has a Gateway row, even if
      // this Apply was a no-op plan (e.g. only configureDriver). Idempotent.
      if (success) {
        try {
          const allGatewayNodes = nodes.filter((n) => {
            const tid = String(n.data?.deviceTypeId ?? '');
            return tid.includes('gateway');
          });
          if (allGatewayNodes.length > 0) {
            const sites = await ctx.prisma.site.findMany({
              where: { siteGroupId: input.siteGroupId },
              select: { id: true, canvasNodeId: true, controlaiTenantId: true, controlaiSiteId: true, tlsServername: true, mqttCert: true, mqttKey: true },
            });
            const siteByCanvas = new Map(sites.map((s) => [s.canvasNodeId, s]));
            const daemonHost = new URL(instance.baseURL).hostname;
            for (const gwNode of allGatewayNodes) {
              // A gateway typically has many edges: incoming sensor lines + one outgoing
              // to a broker. Scan all edges touching this gateway and pick the one whose
              // OTHER end matches a Site we just provisioned.
              const candidateEdges = edges.filter((e) => e.source === gwNode.id || e.target === gwNode.id);
              let boundSite: ReturnType<typeof siteByCanvas.get> | null = null;
              for (const e of candidateEdges) {
                const otherId = e.source === gwNode.id ? e.target : e.source;
                const candidate = siteByCanvas.get(otherId);
                if (candidate?.controlaiTenantId && candidate.controlaiSiteId) {
                  boundSite = candidate;
                  break;
                }
              }
              if (!boundSite?.controlaiTenantId || !boundSite.controlaiSiteId) continue;

              // If site has no cert yet, mint one on demand.
              let certPemEnc = boundSite.mqttCert;
              let keyPemEnc = boundSite.mqttKey;
              let caPemRaw: string | null = null;
              if (!certPemEnc || !keyPemEnc) {
                try {
                  const mint = await callDaemon<{ cert_pem?: string; key_pem?: string; ca_pem?: string }>(
                    instance,
                    `/v1/tenants/${boundSite.controlaiTenantId}/sites/${boundSite.controlaiSiteId}/pki/certs`,
                    { method: 'POST', body: JSON.stringify({ gateway: 'mqtt-bridge' }) },
                  );
                  if (mint.cert_pem && mint.key_pem) {
                    certPemEnc = encryptToken(mint.cert_pem);
                    keyPemEnc = encryptToken(mint.key_pem);
                    // Do NOT silently fall back to cert_pem as the CA — it produces
                    // a Gateway row where rootCaPem == clientCertPem, which makes
                    // embedded TLS clients (board firmware) fail server-cert verify.
                    if (!mint.ca_pem) {
                      console.warn('[apply.commit] daemon mint missing ca_pem; gateway will be unable to verify server cert', { siteId: boundSite.id });
                    }
                    caPemRaw = mint.ca_pem ?? '';
                    await ctx.prisma.site.update({
                      where: { id: boundSite.id },
                      data: { mqttCert: certPemEnc, mqttKey: keyPemEnc },
                    });
                  }
                } catch (mintErr) {
                  console.warn('[apply.commit] lazy cert mint failed', { siteId: boundSite.id, error: mintErr });
                  continue;
                }
              }
              if (!certPemEnc || !keyPemEnc) continue;
              const endpointHost = boundSite.tlsServername ?? `${boundSite.controlaiSiteId}.${boundSite.controlaiTenantId}.${daemonHost}`;
              // Link Gateway → gateway Device so the simulator's
              // reconcileSiteGroup (which looks up Gateway by deviceKey) can find it.
              const gatewayDevice = await ctx.prisma.device.findFirst({
                where: { siteGroupId: input.siteGroupId, canvasNodeId: gwNode.id },
                select: { deviceKey: true },
              });
              const gatewayData = {
                label: inferGatewayLabel(gwNode),
                kind: 'simulator',
                mode: 'cbor-modules-cloud',
                endpointURL: `mqtts://${endpointHost}:8883`,
                groupId: boundSite.controlaiTenantId,
                clientId: `gw-${gwNode.id.slice(0, 8)}`,
                rootCaPemEnc: caPemRaw ? encryptToken(caPemRaw) : certPemEnc,
                clientCertPemEnc: certPemEnc,
                clientKeyPemEnc: keyPemEnc,
                sensors: [],
                desiredState: 'running',
                simulationDesired: true,
                ...(gatewayDevice?.deviceKey ? { deviceKey: gatewayDevice.deviceKey } : {}),
              };
              const existing = await ctx.prisma.gateway.findFirst({
                where: { siteGroupId: input.siteGroupId, canvasNodeId: gwNode.id },
                select: { id: true },
              });
              if (existing) {
                // Re-assert running-state fields too so a previously-stopped
                // gateway gets re-enabled when the user re-Applies.
                await ctx.prisma.gateway.update({
                  where: { id: existing.id },
                  data: {
                    label: gatewayData.label,
                    endpointURL: gatewayData.endpointURL,
                    groupId: gatewayData.groupId,
                    clientId: gatewayData.clientId,
                    desiredState: 'running',
                    simulationDesired: true,
                    ...(gatewayDevice?.deviceKey ? { deviceKey: gatewayDevice.deviceKey } : {}),
                  },
                });
              } else {
                await ctx.prisma.gateway.create({ data: { siteGroupId: input.siteGroupId, canvasNodeId: gwNode.id, ...gatewayData } });
                console.log('[apply.commit] auto-created Gateway', { canvasNodeId: gwNode.id, label: gatewayData.label });
              }
            }
          }
        } catch (gwErr) {
          console.warn('[apply.commit] post-loop gateway auto-create failed', gwErr);
        }
      }

      // Post-loop: auto-reparent sensor Devices to their connected gateway Device
      // so the simulator's reconcileSiteGroup (which groups children by parentDeviceKey)
      // sees a non-empty sensor list. Idempotent — skips already-correct rows.
      if (success) {
        try {
          const gwNodes = nodes.filter((n) => {
            const tid = String(n.data?.deviceTypeId ?? '');
            const m = getDeviceType(tid);
            return m?.category === 'gateway';
          });
          for (const gwNode of gwNodes) {
            const gwDevice = await ctx.prisma.device.findFirst({
              where: { siteGroupId: input.siteGroupId, canvasNodeId: gwNode.id },
              select: { deviceKey: true },
            });
            if (!gwDevice) continue;
            const touchingEdges = edges.filter((e) => e.source === gwNode.id || e.target === gwNode.id);
            for (const edge of touchingEdges) {
              const otherNodeId = edge.source === gwNode.id ? edge.target : edge.source;
              const otherNode = nodes.find((n) => n.id === otherNodeId);
              if (!otherNode) continue;
              const otherTid = String(otherNode.data?.deviceTypeId ?? '');
              const otherManifest = getDeviceType(otherTid);
              // Only reparent sensor-like devices; skip gateway/broker/ingest/tsdb/monitoring.
              if (!otherManifest || otherManifest.category === 'gateway' || INFRA_CATEGORIES.has(otherManifest.category)) continue;
              await ctx.prisma.device.updateMany({
                where: {
                  siteGroupId: input.siteGroupId,
                  canvasNodeId: otherNodeId,
                  NOT: { parentDeviceKey: gwDevice.deviceKey },
                },
                data: { parentDeviceKey: gwDevice.deviceKey },
              });
            }
          }
        } catch (reparentErr) {
          console.warn('[apply.commit] post-loop sensor reparent failed', reparentErr);
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
          resultJson: opResults as unknown as Prisma.InputJsonValue,
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
