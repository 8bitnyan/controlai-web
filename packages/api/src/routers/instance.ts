import { TRPCError } from '@trpc/server';
import { router, orgProcedure, ownerAdminProcedure } from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import { encryptToken, decryptToken } from '../lib/crypto';
import { checkDaemonHealth, DaemonError } from '../lib/daemon-client';
import { z } from 'zod';
import {
  ListInstancesSchema,
  RegisterInstanceSchema,
  UpdateInstanceSchema,
  DeleteInstanceSchema,
  TestConnectionSchema,
} from '@controlai-web/shared-types';

export const instanceRouter = router({
  /**
   * Get a single instance by id. Token is NOT returned.
   */
  get: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), instanceId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const instance = await ctx.prisma.controlaiInstance.findFirst({
        where: { id: input.instanceId, orgId: ctx.orgId! },
        select: {
          id: true,
          name: true,
          baseURL: true,
          status: true,
          lastSeenAt: true,
          version: true,
          capacityUsedMB: true,
          capacityAllowedMB: true,
          createdAt: true,
        },
      });
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND' });
      return instance;
    }),

  /**
   * List instances in org. Token is NOT returned.
   */
  list: orgProcedure
    .input(ListInstancesSchema)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.controlaiInstance.findMany({
        where: { orgId: input.orgId },
        select: {
          id: true,
          name: true,
          baseURL: true,
          status: true,
          lastSeenAt: true,
          version: true,
          capacityUsedMB: true,
          capacityAllowedMB: true,
          createdAt: true,
          // bearerTokenEnc intentionally omitted
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * Register a new instance. Validates connectivity before inserting.
   */
  register: ownerAdminProcedure
    .input(RegisterInstanceSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate connectivity first (10 s timeout)
      let health;
      try {
        health = await checkDaemonHealth(input.baseURL, input.bearerToken);
      } catch (err) {
        if (err instanceof DaemonError && err.statusCode === 401) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Bearer token rejected by daemon (401)`,
          });
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot reach daemon at ${input.baseURL}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const instance = await ctx.prisma.controlaiInstance.create({
        data: {
          orgId: input.orgId,
          name: input.name,
          baseURL: input.baseURL,
          bearerTokenEnc: encryptToken(input.bearerToken),
          status: 'HEALTHY',
          lastSeenAt: new Date(),
          version: health.version ?? null,
          capacityUsedMB: health.capacity?.used_mb ?? null,
          capacityAllowedMB: health.capacity?.allowed_mb ?? null,
          addedById: ctx.userId!,
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: input.orgId,
        userId: ctx.userId,
        action: 'instance.register',
        targetId: instance.id,
        targetType: 'ControlaiInstance',
        metadata: { name: input.name, baseURL: input.baseURL },
      });

      return instance;
    }),

  /**
   * Test connectivity for an existing instance.
   */
  testConnection: ownerAdminProcedure
    .input(TestConnectionSchema)
    .query(async ({ ctx, input }) => {
      const instance = await ctx.prisma.controlaiInstance.findFirst({
        where: { id: input.instanceId, orgId: ctx.orgId! },
      });
      if (!instance) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      try {
        const token = decryptToken(instance.bearerTokenEnc);
        const health = await checkDaemonHealth(instance.baseURL, token);
        return {
          status: 'HEALTHY' as const,
          version: health.version,
          capacityUsedMB: health.capacity?.used_mb,
          capacityAllowedMB: health.capacity?.allowed_mb,
        };
      } catch {
        return { status: 'UNREACHABLE' as const };
      }
    }),

  /**
   * Update instance name or bearer token.
   */
  update: ownerAdminProcedure
    .input(UpdateInstanceSchema)
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.prisma.controlaiInstance.findFirst({
        where: { id: input.instanceId, orgId: ctx.orgId! },
      });
      if (!instance) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      let newTokenEnc = instance.bearerTokenEnc;

      if (input.bearerToken) {
        // Validate new token before storing
        try {
          await checkDaemonHealth(instance.baseURL, input.bearerToken);
        } catch (err) {
          if (err instanceof DaemonError && err.statusCode === 401) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'New token rejected by daemon (401)',
            });
          }
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot reach daemon with new token: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        newTokenEnc = encryptToken(input.bearerToken);
      }

      const updated = await ctx.prisma.controlaiInstance.update({
        where: { id: input.instanceId },
        data: {
          name: input.name,
          bearerTokenEnc: newTokenEnc,
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: instance.orgId,
        userId: ctx.userId,
        action: 'instance.update',
        targetId: instance.id,
        targetType: 'ControlaiInstance',
      });

      return updated;
    }),

  /**
   * Delete an instance — OWNER only; blocked if projects reference it.
   */
  delete: ownerAdminProcedure
    .input(DeleteInstanceSchema)
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.prisma.controlaiInstance.findFirst({
        where: { id: input.instanceId, orgId: ctx.orgId! },
        include: { projects: { select: { name: true } } },
      });
      if (!instance) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      // Verify caller is OWNER
      const member = await ctx.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: instance.orgId, userId: ctx.userId! } },
      });
      if (member?.role !== 'OWNER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the org OWNER can delete an instance',
        });
      }

      if (instance.projects.length > 0) {
        const names = instance.projects.map((p) => p.name).join(', ');
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete instance: the following projects depend on it — ${names}`,
        });
      }

      await ctx.prisma.controlaiInstance.delete({
        where: { id: input.instanceId },
      });

      void writeAudit(ctx.prisma, {
        orgId: instance.orgId,
        userId: ctx.userId,
        action: 'instance.delete',
        targetId: instance.id,
        targetType: 'ControlaiInstance',
      });

      return { success: true };
    }),
});
