import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  router,
  protectedProcedure,
  orgProcedure,
  ownerAdminProcedure,
} from '../trpc';
import { writeAudit } from '../lib/audit-writer';
import {
  CreateOrgSchema,
  UpdateOrgSchema,
  DeleteOrgSchema,
  InviteMemberSchema,
  AcceptInvitationSchema,
  RemoveMemberSchema,
  UpdateMemberRoleSchema,
} from '@controlai-web/shared-types';

export const orgRouter = router({
  /**
   * List all orgs the current user belongs to.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.organizationMember.findMany({
      where: { userId: ctx.userId! },
      include: { org: true },
    });
  }),

  /**
   * Create a new organisation. The caller becomes OWNER.
   */
  create: protectedProcedure
    .input(CreateOrgSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.organization.findUnique({
        where: { slug: input.slug },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Slug already taken',
        });
      }

      // Enforce max 5 orgs per user
      const membershipCount = await ctx.prisma.organizationMember.count({
        where: { userId: ctx.userId! },
      });
      if (membershipCount >= 5) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You may not belong to more than 5 organisations',
        });
      }

      const org = await ctx.prisma.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          members: {
            create: { userId: ctx.userId!, role: 'OWNER' },
          },
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: org.id,
        userId: ctx.userId,
        action: 'org.create',
        targetId: org.id,
        targetType: 'Organization',
      });

      return org;
    }),

  /**
   * Update org name.
   */
  update: ownerAdminProcedure
    .input(UpdateOrgSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.update({
        where: { id: input.orgId },
        data: { name: input.name },
      });

      void writeAudit(ctx.prisma, {
        orgId: org.id,
        userId: ctx.userId,
        action: 'org.update',
        targetId: org.id,
        targetType: 'Organization',
      });

      return org;
    }),

  /**
   * Delete an org — OWNER only. Blocked if active projects exist.
   */
  delete: protectedProcedure
    .input(DeleteOrgSchema)
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.organizationMember.findUnique({
        where: {
          orgId_userId: { orgId: input.orgId, userId: ctx.userId! },
        },
      });
      if (!member || member.role !== 'OWNER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the org OWNER can delete an organisation',
        });
      }

      const projectCount = await ctx.prisma.project.count({
        where: { orgId: input.orgId },
      });
      if (projectCount > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete org with active projects',
        });
      }

      await ctx.prisma.organization.delete({ where: { id: input.orgId } });

      return { success: true };
    }),

  /**
   * List org members.
   */
  listMembers: orgProcedure
    .input(z.object({ orgId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.organizationMember.findMany({
        where: { orgId: input.orgId },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      });
    }),

  /**
   * Invite a member by email.
   */
  inviteMember: ownerAdminProcedure
    .input(InviteMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invitation = await ctx.prisma.organizationInvitation.create({
        data: {
          orgId: input.orgId,
          email: input.email,
          role: input.role,
          expiresAt,
          inviterId: ctx.userId,
        },
      });

      void writeAudit(ctx.prisma, {
        orgId: input.orgId,
        userId: ctx.userId,
        action: 'org.inviteMember',
        targetId: invitation.id,
        targetType: 'OrganizationInvitation',
        metadata: { email: input.email, role: input.role },
      });

      return invitation;
    }),

  /**
   * Accept an invitation by token.
   */
  acceptInvitation: protectedProcedure
    .input(AcceptInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.organizationInvitation.findUnique({
        where: { token: input.token },
      });

      if (!invitation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' });
      }

      if (invitation.status !== 'PENDING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has already been used',
        });
      }

      if (invitation.expiresAt < new Date()) {
        await ctx.prisma.organizationInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation expired',
        });
      }

      const [member] = await ctx.prisma.$transaction([
        ctx.prisma.organizationMember.upsert({
          where: {
            orgId_userId: {
              orgId: invitation.orgId,
              userId: ctx.userId!,
            },
          },
          create: {
            orgId: invitation.orgId,
            userId: ctx.userId!,
            role: invitation.role,
          },
          update: { role: invitation.role },
        }),
        ctx.prisma.organizationInvitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED' },
        }),
      ]);

      return member;
    }),

  /**
   * Remove a member from the org (OWNER/ADMIN only).
   */
  removeMember: ownerAdminProcedure
    .input(RemoveMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
      });
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      }
      if (target.role === 'OWNER') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove the org OWNER',
        });
      }

      await ctx.prisma.organizationMember.delete({
        where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
      });

      void writeAudit(ctx.prisma, {
        orgId: input.orgId,
        userId: ctx.userId,
        action: 'org.removeMember',
        targetId: input.userId,
        targetType: 'User',
      });

      return { success: true };
    }),

  /**
   * Update a member's role (OWNER/ADMIN only; cannot change owner).
   */
  updateMemberRole: ownerAdminProcedure
    .input(UpdateMemberRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
      });
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (target.role === 'OWNER') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot change the OWNER role directly; use owner transfer',
        });
      }

      const updated = await ctx.prisma.organizationMember.update({
        where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
        data: { role: input.role },
      });

      void writeAudit(ctx.prisma, {
        orgId: input.orgId,
        userId: ctx.userId,
        action: 'org.updateMemberRole',
        targetId: input.userId,
        targetType: 'User',
        metadata: { newRole: input.role },
      });

      return updated;
    }),
});
