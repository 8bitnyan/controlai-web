import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, orgProcedure } from '../trpc';

export const dashboardRouter = router({
  /**
   * Load the dashboard layout for a SiteGroup.
   * Returns null if no dashboard exists yet.
   */
  load: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      return ctx.prisma.dashboard.findUnique({
        where: { siteGroupId: input.siteGroupId },
      });
    }),

  /**
   * Upsert the dashboard layout for a SiteGroup.
   */
  save: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteGroupId: z.string().cuid(),
        layout: z.array(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sg = await ctx.prisma.siteGroup.findFirst({
        where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } },
      });
      if (!sg) throw new TRPCError({ code: 'FORBIDDEN' });

      return ctx.prisma.dashboard.upsert({
        where: { siteGroupId: input.siteGroupId },
        create: {
          siteGroupId: input.siteGroupId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          layout: input.layout as any,
        },
        update: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          layout: input.layout as any,
          updatedAt: new Date(),
        },
      });
    }),
});
