import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Prisma } from '@controlai-web/db';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';

const legacyBindingSchema = z.object({
  siteId: z.string().optional(),
  topic: z.string().optional(),
});

const bindingV2Schema = z.object({
  deviceKey: z.string().min(1),
  metric: z.string().min(1),
});

const widgetSchema = z
  .object({
    id: z.string(),
    binding: legacyBindingSchema.optional().nullable(),
    bindingV2: bindingV2Schema.optional().nullable(),
  })
  .passthrough();

const topicClientIdRegex = /modules\/[^/]+\/(NBIRTH|NDATA|NDEATH)\/([0-9A-F]{24})$/;

function parseClientIdFromTopic(topic?: string): string | null {
  if (!topic) return null;
  const match = topic.match(topicClientIdRegex);
  if (match?.[2]) return match[2];
  const parts = topic.split('/').filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : null;
  return last ?? null;
}

function deriveMetricFromTopic(topic?: string): string {
  if (!topic) return 'value';
  return topic.includes('/NBIRTH/') ? 'birth' : topic.includes('/NDEATH/') ? 'death' : 'value';
}

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

      const dashboard = await ctx.prisma.dashboard.findUnique({
        where: { siteGroupId: input.siteGroupId },
      });

      if (!dashboard) return null;

      const layout = z.array(widgetSchema).safeParse(dashboard.layout);
      if (!layout.success) return dashboard;

      let changed = false;
      const migratedWidgets = await Promise.all(
        layout.data.map(async (widget) => {
          if (widget.bindingV2 || !widget.binding?.topic) return widget;

          const clientId = parseClientIdFromTopic(widget.binding.topic);
          if (!clientId) return widget;

          const gateway = await ctx.prisma.gateway.findFirst({
            where: { siteGroupId: input.siteGroupId, clientId },
            select: { deviceKey: true },
          });

          if (!gateway?.deviceKey) return widget;

          changed = true;
          const newBindingV2 = {
            deviceKey: gateway.deviceKey,
            metric: deriveMetricFromTopic(widget.binding.topic),
          };

          void writeAudit(ctx.prisma, {
            orgId: ctx.orgId!,
            userId: ctx.userId,
            action: 'dashboard.binding-migrated',
            targetType: 'Dashboard',
            targetId: dashboard.id,
            metadata: {
              widgetId: widget.id,
              oldBinding: widget.binding,
              newBindingV2,
            },
          });

          return {
            ...widget,
            bindingV2: newBindingV2,
          };
        }),
      );

      if (!changed) return dashboard;

      const updated = await ctx.prisma.dashboard.update({
        where: { id: dashboard.id },
        data: {
          layout: migratedWidgets as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });

      return updated;
    }),

  /**
   * Upsert the dashboard layout for a SiteGroup.
   */
  save: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteGroupId: z.string().cuid(),
        layout: z.array(widgetSchema),
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
          layout: input.layout as Prisma.InputJsonValue,
        },
        update: {
          layout: input.layout as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
    }),
});
