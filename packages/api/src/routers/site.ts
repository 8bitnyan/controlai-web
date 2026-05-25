import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, orgProcedure, ownerAdminProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import {
  ListSitesSchema,
  CreateSiteSchema,
  UpdateSiteSchema,
  DeleteSiteSchema,
} from '@controlai-web/shared-types';

export const siteRouter = router({
  list: orgProcedure
    .input(ListSitesSchema)
    .query(async ({ ctx, input }) => {
      const siteGroup = await ctx.prisma.siteGroup.findUnique({
        where: { id: input.siteGroupId },
        include: { project: true },
      });
      if (!siteGroup || siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.prisma.site.findMany({
        where: { siteGroupId: input.siteGroupId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          siteGroupId: true,
          canvasNodeId: true,
          name: true,
          brokerKind: true,
          ingestDirection: true,
          throughputTier: true,
          retentionPeriod: true,
          controlaiTenantId: true,
          controlaiSiteId: true,
          tlsServername: true,
          createdAt: true,
          updatedAt: true,
          mqttCert: true,
        },
      }).then((sites) =>
        sites.map((site) => ({
          ...site,
          hasMqttCert: Boolean(site.mqttCert),
          mqttCert: undefined,
        })),
      );
    }),

  bind: ownerAdminProcedure
    .input(z.object({ siteId: z.string().cuid(), canvasNodeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const site = await ctx.prisma.site.findUnique({
        where: { id: input.siteId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!site || site.siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.prisma.site.update({
        where: { id: input.siteId },
        data: { canvasNodeId: input.canvasNodeId },
      });
    }),

  unbind: ownerAdminProcedure
    .input(z.object({ siteId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const site = await ctx.prisma.site.findUnique({
        where: { id: input.siteId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!site || site.siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.prisma.site.update({
        where: { id: input.siteId },
        data: { canvasNodeId: null },
      });
    }),

  create: ownerAdminProcedure
    .input(CreateSiteSchema)
    .mutation(async ({ ctx, input }) => {
      const siteGroup = await ctx.prisma.siteGroup.findUnique({
        where: { id: input.siteGroupId },
        include: { project: true },
      });
      if (!siteGroup || siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const site = await ctx.prisma.site.create({
        data: {
          siteGroupId: input.siteGroupId,
          name: input.name,
          brokerKind: input.brokerKind ?? null,
          ingestDirection: input.ingestDirection ?? null,
          throughputTier: input.throughputTier ?? null,
          retentionPeriod: input.retentionPeriod ?? null,
          // controlaiTenantId and controlaiSiteId are null — populated by Apply
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: siteGroup.project.orgId,
        userId: ctx.userId,
        action: 'site.create',
        targetId: site.id,
        targetType: 'Site',
        metadata: { name: input.name },
      });

      return site;
    }),

  update: ownerAdminProcedure
    .input(UpdateSiteSchema)
    .mutation(async ({ ctx, input }) => {
      const site = await ctx.prisma.site.findUnique({
        where: { id: input.siteId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!site || site.siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.prisma.site.update({
        where: { id: input.siteId },
        data: {
          name: input.name,
          brokerKind: input.brokerKind,
          ingestDirection: input.ingestDirection,
          throughputTier: input.throughputTier,
          retentionPeriod: input.retentionPeriod,
        },
      });
    }),

  delete: ownerAdminProcedure
    .input(DeleteSiteSchema)
    .mutation(async ({ ctx, input }) => {
      const site = await ctx.prisma.site.findUnique({
        where: { id: input.siteId },
        include: { siteGroup: { include: { project: true } } },
      });
      if (!site || site.siteGroup.project.orgId !== ctx.orgId!) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      if (site.controlaiTenantId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Site is provisioned — delete via Apply or manually decommission the daemon tenant first',
        });
      }

      await ctx.prisma.site.delete({ where: { id: input.siteId } });

      void writeAudit(ctx.prisma, {
        orgId: site.siteGroup.project.orgId,
        userId: ctx.userId,
        action: 'site.delete',
        targetId: site.id,
        targetType: 'Site',
      });

      return { success: true };
    }),
});
