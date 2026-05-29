import { TRPCError } from '@trpc/server';
import { assertKnownDeviceType, LEGACY_TYPE_MAP } from '@controlai-web/shared-types';
import { z } from 'zod';
import { createDeviceInternal, deleteDeviceInternal } from '../lib/device-internal';
import { router, orgProcedure } from '../trpc';

export const nodeConfigRouter = router({
  /**
   * Load the active NodeConfig for a SiteGroup (isActive=true), or the latest
   * draft if no active version exists. Returns null when no config exists.
   */
  load: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      // Verify the siteGroup belongs to the org
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      const active = await ctx.prisma.nodeConfig.findFirst({
        where: { siteGroupId: input.siteGroupId, isActive: true },
        orderBy: { version: 'desc' },
      });
      if (active) {
        const nodes = (active.nodes as unknown[]).map((node) => {
          const parsedNode = z
            .object({
              type: z.string().optional(),
              data: z.record(z.string(), z.unknown()).optional(),
            })
            .passthrough()
            .parse(node);
          if (parsedNode.data?.deviceTypeId) return node;
          if (!parsedNode.type || !(parsedNode.type in LEGACY_TYPE_MAP)) return node;
          return {
            ...parsedNode,
            data: {
              ...(parsedNode.data ?? {}),
              deviceTypeId: LEGACY_TYPE_MAP[parsedNode.type as keyof typeof LEGACY_TYPE_MAP],
            },
          };
        });
        return { ...active, nodes };
      }

      const latest = await ctx.prisma.nodeConfig.findFirst({
        where: { siteGroupId: input.siteGroupId },
        orderBy: { version: 'desc' },
      });
      return latest ?? null;
    }),

  /**
   * Save a draft NodeConfig (isActive=false).
   * If a draft already exists (no appliedAt), it updates in-place.
   * If the latest version is active (was applied), it creates a new version.
   */
  save: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteGroupId: z.string().cuid(),
        nodes: z.array(z.unknown()),
        edges: z.array(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      for (const node of input.nodes) {
        const parsedNode = z
          .object({
            data: z.object({ deviceTypeId: z.string().optional() }).optional(),
          })
          .passthrough()
          .parse(node);
        const deviceTypeId = parsedNode.data?.deviceTypeId;
        if (!deviceTypeId) continue;
        try {
          assertKnownDeviceType(deviceTypeId);
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown device-type: ${deviceTypeId}` });
        }
      }

      // Find the latest version
      const latest = await ctx.prisma.nodeConfig.findFirst({
        where: { siteGroupId: input.siteGroupId },
        orderBy: { version: 'desc' },
      });

      type ConfigNode = { id: string; data?: { deviceTypeId?: string; config?: unknown } };
      type ConfigEdge = { source?: string; target?: string };

      const previousNodes = latest ? ((latest.nodes as unknown as ConfigNode[]) ?? []) : [];
      const newNodes = input.nodes as ConfigNode[];
      const newEdges = input.edges as ConfigEdge[];

      const persisted = await (!latest || latest.isActive
        ? ctx.prisma.nodeConfig.create({
            data: {
              siteGroupId: input.siteGroupId,
              version: latest ? latest.version + 1 : 1,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              nodes: input.nodes as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              edges: input.edges as any,
              isActive: false,
            },
          })
        : ctx.prisma.nodeConfig.update({
            where: { id: latest.id },
            data: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              nodes: input.nodes as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              edges: input.edges as any,
              updatedAt: new Date(),
            },
          }));

      const prevIds = new Set(previousNodes.map((n) => n.id));
      const newIds = new Set(newNodes.map((n) => n.id));
      const added = newNodes.filter((n) => !prevIds.has(n.id));
      const removed = previousNodes.filter((n) => !newIds.has(n.id));

      const findParentCanvasNodeId = (canvasNodeId: string): string | null => {
        const edge = newEdges.find((candidate) => candidate.target === canvasNodeId);
        return edge?.source ?? null;
      };

      for (const node of added) {
        const parentCanvasNodeId = findParentCanvasNodeId(node.id);
        let parentDeviceKey: string | null = null;
        if (parentCanvasNodeId) {
          const parent = await ctx.prisma.device.findUnique({
            where: {
              siteGroupId_canvasNodeId: {
                siteGroupId: input.siteGroupId,
                canvasNodeId: parentCanvasNodeId,
              },
            },
            select: { deviceKey: true },
          });
          parentDeviceKey = parent?.deviceKey ?? null;
        }

        await createDeviceInternal(
          {
            siteGroupId: input.siteGroupId,
            canvasNodeId: node.id,
            deviceTypeId: node.data?.deviceTypeId ?? 'core-generic-sensor',
            parentDeviceKey,
            config: (node.data?.config ?? {}) as object,
            simulationDesired: true,
            orgId: ctx.orgId!,
            userId: ctx.userId,
          },
          ctx.prisma,
        );
      }

      for (const node of removed) {
        const device = await ctx.prisma.device.findUnique({
          where: {
            siteGroupId_canvasNodeId: {
              siteGroupId: input.siteGroupId,
              canvasNodeId: node.id,
            },
          },
          select: { deviceKey: true },
        });
        if (!device) continue;
        await deleteDeviceInternal({
          deviceKey: device.deviceKey,
          db: ctx.prisma,
          orgId: ctx.orgId!,
          userId: ctx.userId,
        });
      }

      return persisted;
    }),

  /**
   * List version metadata for a SiteGroup (without nodes/edges payload).
   */
  listVersions: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      return ctx.prisma.nodeConfig.findMany({
        where: { siteGroupId: input.siteGroupId },
        select: {
          id: true,
          version: true,
          isActive: true,
          appliedAt: true,
          appliedHash: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { version: 'desc' },
      });
    }),

  /**
   * Mark one NodeConfig version as active (clears isActive on all others).
   * Called by apply.commit on success.
   */
  setActive: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        nodeConfigId: z.string().cuid(),
        appliedHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const nc = await ctx.prisma.nodeConfig.findUnique({
        where: { id: input.nodeConfigId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!nc || nc.siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Clear all other active flags for this siteGroup
      await ctx.prisma.nodeConfig.updateMany({
        where: { siteGroupId: nc.siteGroupId, isActive: true },
        data: { isActive: false },
      });

      return ctx.prisma.nodeConfig.update({
        where: { id: input.nodeConfigId },
        data: {
          isActive: true,
          appliedAt: new Date(),
          appliedHash: input.appliedHash ?? null,
        },
      });
    }),
});
