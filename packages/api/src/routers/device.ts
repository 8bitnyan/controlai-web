import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Prisma } from '@controlai-web/db';
import { router, orgProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { createDeviceInternal, deleteDeviceInternal } from '../lib/device-internal';

const listInput = z.object({
  orgId: z.string().cuid(),
  siteGroupId: z.string().cuid(),
  registrationState: z.enum(['UNREGISTERED', 'REGISTERING', 'REGISTERED', 'ORPHANED']).optional(),
  deviceTypeId: z.string().optional(),
  parentDeviceKey: z.string().optional(),
});

export const deviceRouter = router({
  list: orgProcedure.input(listInput).query(async ({ ctx, input }) => {
    return ctx.prisma.device.findMany({
      where: {
        siteGroupId: input.siteGroupId,
        ...(input.registrationState ? { registrationState: input.registrationState } : {}),
        ...(input.deviceTypeId ? { deviceTypeId: input.deviceTypeId } : {}),
        ...(input.parentDeviceKey ? { parentDeviceKey: input.parentDeviceKey } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  get: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), deviceKey: z.string() }))
    .query(async ({ ctx, input }) => ctx.prisma.device.findUnique({ where: { deviceKey: input.deviceKey } })),

  create: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        siteGroupId: z.string().cuid(),
        canvasNodeId: z.string().min(1),
        deviceTypeId: z.string().min(1),
        parentDeviceKey: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        portBindings: z.record(z.string(), z.unknown()).optional(),
        shadowUuid: z.string().optional(),
        simulationDesired: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      createDeviceInternal(
        {
          orgId: ctx.orgId!,
          userId: ctx.userId,
          siteGroupId: input.siteGroupId,
          canvasNodeId: input.canvasNodeId,
          deviceTypeId: input.deviceTypeId,
          parentDeviceKey: input.parentDeviceKey,
          config: input.config as Prisma.InputJsonValue | undefined,
          portBindings: input.portBindings as Prisma.InputJsonValue | undefined,
          shadowUuid: input.shadowUuid,
          simulationDesired: input.simulationDesired,
        },
        ctx.prisma,
      ),
    ),

  update: orgProcedure
    .input(
      z.object({
        orgId: z.string().cuid(),
        deviceKey: z.string(),
        config: z.record(z.string(), z.unknown()).optional(),
        portBindings: z.record(z.string(), z.unknown()).optional(),
        simulationDesired: z.boolean().optional(),
        registrationState: z.enum(['UNREGISTERED', 'REGISTERING', 'REGISTERED', 'ORPHANED']).optional(),
        realUuid: z.string().nullable().optional(),
        registeredAt: z.date().nullable().optional(),
        registeredByUserId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.device.findUnique({ where: { deviceKey: input.deviceKey } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found' });

      if (
        existing.registrationState !== 'UNREGISTERED' &&
        (input.config !== undefined || input.portBindings !== undefined)
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'config and portBindings are immutable when device is not UNREGISTERED',
        });
      }

      const updated = await ctx.prisma.device.update({
        where: { deviceKey: input.deviceKey },
        data: {
          ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
          ...(input.portBindings !== undefined
            ? { portBindings: input.portBindings as Prisma.InputJsonValue }
            : {}),
          ...(input.simulationDesired !== undefined ? { simulationDesired: input.simulationDesired } : {}),
          ...(input.registrationState !== undefined ? { registrationState: input.registrationState } : {}),
          ...(input.realUuid !== undefined ? { realUuid: input.realUuid } : {}),
          ...(input.registeredAt !== undefined ? { registeredAt: input.registeredAt } : {}),
          ...(input.registeredByUserId !== undefined ? { registeredByUserId: input.registeredByUserId } : {}),
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'device.update',
        targetId: updated.deviceKey,
        targetType: 'Device',
      });

      return updated;
    }),

  delete: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), deviceKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteDeviceInternal({ deviceKey: input.deviceKey, db: ctx.prisma, orgId: ctx.orgId!, userId: ctx.userId });
      return { ok: true };
    }),

  setSiteGroupSimulation: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid(), desired: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.device.updateMany({
        where: { siteGroupId: input.siteGroupId },
        data: { simulationDesired: input.desired },
      });

      let simulatorContact: 'ok' | 'failed' = 'ok';
      const simulatorUrl = process.env.SIMULATOR_INTERNAL_URL ?? 'http://localhost:4001';
      const simulatorApiToken = process.env.SIMULATOR_API_TOKEN ?? '';
      try {
        const res = await fetch(`${simulatorUrl}/sitegroups/${input.siteGroupId}/simulation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(simulatorApiToken ? { Authorization: `Bearer ${simulatorApiToken}` } : {}),
          },
          body: JSON.stringify({ desired: input.desired }),
        });
        if (!res.ok) simulatorContact = 'failed';
      } catch {
        simulatorContact = 'failed';
      }

      void writeAudit(ctx.prisma, {
        orgId: ctx.orgId!,
        userId: ctx.userId,
        action: 'device.bulk-simulation-toggle',
        targetType: 'Device',
        metadata: {
          siteGroupId: input.siteGroupId,
          desired: input.desired,
          affectedCount: updated.count,
        },
      });

      return { success: true, affectedCount: updated.count, simulatorContact };
    }),
});
