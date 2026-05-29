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
  ProvisionInstanceSchema,
  RetryProvisionSchema,
  DeprovisionInstanceSchema,
} from '@controlai-web/shared-types';
import { deriveSubdomain, SLUG_REGEX } from '../lib/org-slug';
import { getProvisioner } from '../lib/instance-provisioner';
import { provisionTask } from '../lib/provision-task';

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
          env: true,
          provisioningStartedAt: true,
          provisionProgress: true,
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
          env: true,
          provisioningStartedAt: true,
          provisionerInstanceId: true,
          provisionProgress: true,
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

  provision: ownerAdminProcedure
    .input(ProvisionInstanceSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({ where: { id: input.orgId }, select: { id: true, slug: true } });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!SLUG_REGEX.test(org.slug)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Org slug does not meet provisioning requirements (must match ^[a-z][a-z0-9-]{1,63}$)' });
      }
      const existing = await ctx.prisma.controlaiInstance.findFirst({ where: { orgId: input.orgId, env: input.env }, select: { id: true } });
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: `An instance already exists for env=${input.env} in this org (id=${existing.id})` });

      const subdomain = deriveSubdomain(org.slug, input.env);
      const baseURL = `https://${subdomain}.${process.env.DAEMON_BASE_DOMAIN}`;
      const instance = await ctx.prisma.controlaiInstance.create({
        data: {
          status: 'PROVISIONING',
          bearerTokenEnc: encryptToken('PLACEHOLDER'),
          provisioningStartedAt: new Date(),
          env: input.env,
          name: input.name,
          addedById: ctx.userId!,
          orgId: input.orgId,
          baseURL,
        },
      });
      void provisionTask(ctx.prisma, instance.id, { orgId: input.orgId, orgSlug: org.slug, subdomain, env: input.env, baseURL });
      return { id: instance.id };
    }),

  retryProvision: ownerAdminProcedure
    .input(RetryProvisionSchema)
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.prisma.controlaiInstance.findFirst({ where: { id: input.instanceId, orgId: ctx.orgId! } });
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND' });
      if (instance.env === null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot retry a BYO-registered instance' });
      const env = instance.env as 'prod' | 'staging' | 'dev';
      if (!['PROVISIONING', 'PROVISION_FAILED'].includes(instance.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot retry provisioning from status=${instance.status}` });
      }
      const org = await ctx.prisma.organization.findUnique({ where: { id: instance.orgId }, select: { slug: true } });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!SLUG_REGEX.test(org.slug)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Org slug does not meet provisioning requirements (must match ^[a-z][a-z0-9-]{1,63}$)' });
      }

      await ctx.prisma.controlaiInstance.update({ where: { id: instance.id }, data: { status: 'PROVISIONING', provisioningStartedAt: new Date() } });
      void provisionTask(ctx.prisma, instance.id, { orgId: instance.orgId, orgSlug: org.slug, subdomain: deriveSubdomain(org.slug, env), env, baseURL: instance.baseURL });
      void writeAudit(ctx.prisma, { orgId: instance.orgId, userId: ctx.userId, action: 'instance.retryProvision', targetId: instance.id, targetType: 'ControlaiInstance', metadata: { previousStatus: instance.status } });
      return { id: instance.id };
    }),

  deprovision: ownerAdminProcedure
    .input(DeprovisionInstanceSchema)
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.prisma.controlaiInstance.findFirst({ where: { id: input.instanceId, orgId: ctx.orgId! }, include: { projects: { select: { name: true } } } });
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND' });
      const member = await ctx.prisma.organizationMember.findUnique({ where: { orgId_userId: { orgId: instance.orgId, userId: ctx.userId! } } });
      if (member?.role !== 'OWNER') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the org OWNER can deprovision an instance' });
      if (instance.projects.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot deprovision instance: the following projects depend on it — ${instance.projects.map((p) => p.name).join(', ')}` });
      }
      const provisioner = getProvisioner();
      if (instance.provisionerInstanceId) {
        try {
          await provisioner.deprovision({ provisionerInstanceId: instance.provisionerInstanceId, baseURL: instance.baseURL });
        } catch (err) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to deprovision backend resources; manual cleanup may be required: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      await ctx.prisma.controlaiInstance.delete({ where: { id: input.instanceId } });
      void writeAudit(ctx.prisma, {
        orgId: instance.orgId,
        userId: ctx.userId,
        action: 'instance.deprovision',
        targetId: instance.id,
        targetType: 'ControlaiInstance',
        metadata: provisioner.backend === 'ec2'
          ? {
              provisionerBackend: provisioner.backend,
              env: instance.env,
              awsRegion: process.env.AWS_REGION,
              taskArn: instance.provisionerInstanceId,
            }
          : { provisionerBackend: provisioner.backend, env: instance.env },
      });
      return { success: true };
    }),
});
