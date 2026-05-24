import { TRPCError } from '@trpc/server';
import { router, orgProcedure, ownerAdminProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import {
  ListProjectsSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  DeleteProjectSchema,
} from '@controlai-web/shared-types';

export const projectRouter = router({
  list: orgProcedure
    .input(ListProjectsSchema)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.project.findMany({
        where: { orgId: input.orgId },
        include: {
          instance: {
            select: { id: true, name: true, status: true },
          },
          _count: { select: { siteGroups: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  create: ownerAdminProcedure
    .input(CreateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify instance belongs to the same org
      const instance = await ctx.prisma.controlaiInstance.findFirst({
        where: { id: input.instanceId, orgId: input.orgId },
      });
      if (!instance) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Instance does not belong to this organization',
        });
      }

      const project = await ctx.prisma.project.create({
        data: {
          orgId: input.orgId,
          instanceId: input.instanceId,
          name: input.name,
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: input.orgId,
        userId: ctx.userId,
        action: 'project.create',
        targetId: project.id,
        targetType: 'Project',
        metadata: { name: input.name },
      });

      return project;
    }),

  update: ownerAdminProcedure
    .input(UpdateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify project belongs to caller's org
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId, orgId: ctx.orgId! },
      });
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      const updated = await ctx.prisma.project.update({
        where: { id: input.projectId },
        data: { name: input.name },
      });

      void writeAudit(ctx.prisma, {
        orgId: project.orgId,
        userId: ctx.userId,
        action: 'project.update',
        targetId: project.id,
        targetType: 'Project',
      });

      return updated;
    }),

  delete: ownerAdminProcedure
    .input(DeleteProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId, orgId: ctx.orgId! },
      });
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      await ctx.prisma.project.delete({ where: { id: input.projectId } });

      void writeAudit(ctx.prisma, {
        orgId: project.orgId,
        userId: ctx.userId,
        action: 'project.delete',
        targetId: project.id,
        targetType: 'Project',
      });

      return { success: true };
    }),
});
