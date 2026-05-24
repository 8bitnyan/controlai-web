import { TRPCError } from '@trpc/server';
import { z } from 'zod';
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
      if (active) return active;

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

      // Find the latest version
      const latest = await ctx.prisma.nodeConfig.findFirst({
        where: { siteGroupId: input.siteGroupId },
        orderBy: { version: 'desc' },
      });

      if (!latest || latest.isActive) {
        // Create a new draft version
        const nextVersion = latest ? latest.version + 1 : 1;
        return ctx.prisma.nodeConfig.create({
          data: {
            siteGroupId: input.siteGroupId,
            version: nextVersion,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodes: input.nodes as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            edges: input.edges as any,
            isActive: false,
          },
        });
      }

      // Update the existing draft in place
      return ctx.prisma.nodeConfig.update({
        where: { id: latest.id },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodes: input.nodes as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          edges: input.edges as any,
          updatedAt: new Date(),
        },
      });
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
