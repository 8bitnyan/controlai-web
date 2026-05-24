import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { TRPCContext } from './context';

const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;

/**
 * Public procedure — no authentication required.
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure — requires a valid session.
 */
const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be signed in to perform this action',
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: ctx.session.user.id,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * Org procedure — requires valid session + verified org membership.
 * Reads `orgId` from input (supports multi-org users).
 */
const isOrgMember = middleware(async ({ ctx, rawInput, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const input = rawInput as { orgId?: string };
  const orgId = input.orgId;

  if (!orgId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'orgId is required for this procedure',
    });
  }

  const member = await ctx.prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: ctx.session.user.id } },
  });

  if (!member) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of this organization',
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: ctx.session.user.id,
      orgId,
      orgRole: member.role,
    },
  });
});

export const orgProcedure = t.procedure.use(isOrgMember);

/**
 * Owner/Admin procedure — requires OWNER or ADMIN role in the org.
 */
const isOwnerOrAdmin = middleware(async ({ ctx, rawInput, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const input = rawInput as { orgId?: string };
  const orgId = input.orgId;

  if (!orgId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'orgId is required for this procedure',
    });
  }

  const member = await ctx.prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: ctx.session.user.id } },
  });

  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  if (member.role === 'MEMBER') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This action requires OWNER or ADMIN role',
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: ctx.session.user.id,
      orgId,
      orgRole: member.role,
    },
  });
});

export const ownerAdminProcedure = t.procedure.use(isOwnerOrAdmin);

/**
 * Log UNAUTHORIZED / FORBIDDEN errors for audit trail.
 */
export function onErrorHandler({
  error,
  path,
  ctx,
}: {
  error: TRPCError;
  path?: string;
  ctx?: TRPCContext;
}): void {
  if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
    console.warn('[trpc] Access denied', {
      code: error.code,
      path,
      userId: ctx?.userId,
    });
  }
}
