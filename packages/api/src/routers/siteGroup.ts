import { TRPCError } from '@trpc/server';
import { router, orgProcedure, ownerAdminProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import {
  ListSiteGroupsSchema,
  CreateSiteGroupSchema,
  UpdateSiteGroupSchema,
  DeleteSiteGroupSchema,
} from '@controlai-web/shared-types';

export const siteGroupRouter = router({
  list: orgProcedure
    .input(ListSiteGroupsSchema)
    .query(async ({ ctx, input }) => {
      // Verify the project belongs to the org
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId, orgId: ctx.orgId! },
      });
      if (!project) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.prisma.siteGroup.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { sites: true } } },
        orderBy: { createdAt: 'asc' },
      });
    }),

  create: ownerAdminProcedure
    .input(CreateSiteGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId, orgId: ctx.orgId! },
      });
      if (!project) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const siteGroup = await ctx.prisma.siteGroup.create({
        data: { projectId: input.projectId, name: input.name },
      });

      void writeAudit(ctx.prisma, {
        orgId: project.orgId,
        userId: ctx.userId,
        action: 'siteGroup.create',
        targetId: siteGroup.id,
        targetType: 'SiteGroup',
        metadata: { name: input.name },
      });

      return siteGroup;
    }),

  update: ownerAdminProcedure
    .input(UpdateSiteGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const siteGroup = await ctx.prisma.siteGroup.findUnique({
        where: { id: input.siteGroupId },
        include: { project: true },
      });
      if (!siteGroup || siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.prisma.siteGroup.update({
        where: { id: input.siteGroupId },
        data: { name: input.name },
      });
    }),

  delete: ownerAdminProcedure
    .input(DeleteSiteGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const siteGroup = await ctx.prisma.siteGroup.findUnique({
        where: { id: input.siteGroupId },
        include: { project: true },
      });
      if (!siteGroup || siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      await ctx.prisma.siteGroup.delete({ where: { id: input.siteGroupId } });

      void writeAudit(ctx.prisma, {
        orgId: siteGroup.project.orgId,
        userId: ctx.userId,
        action: 'siteGroup.delete',
        targetId: siteGroup.id,
        targetType: 'SiteGroup',
      });

      return { success: true };
    }),
});
