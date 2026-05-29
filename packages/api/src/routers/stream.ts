import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { SignJWT } from 'jose';
import { router, orgProcedure } from '../trpc';

// Validate STREAM_JWT_SECRET is set at startup
const STREAM_JWT_SECRET_RAW = process.env.STREAM_JWT_SECRET;
const STREAM_SERVICE_URL = process.env.STREAM_SERVICE_URL ?? 'http://localhost:4002';
const SIMULATOR_PUBLIC_URL = process.env.SIMULATOR_PUBLIC_URL ?? 'http://localhost:4001';

if (!STREAM_JWT_SECRET_RAW) {
  console.warn(
    '[stream] STREAM_JWT_SECRET is not set — stream.token will fail at runtime. Set this env var before going to production.',
  );
}

export const streamRouter = router({
  /**
   * Mint a short-lived HS256 JWT for the mqtt-bridge SSE endpoint.
   * The browser uses this token as ?token=<jwt> on the EventSource URL.
   */
  token: orgProcedure
    /** @deprecated use stream.siteGroupToken */
    .input(z.object({ orgId: z.string().cuid(), siteId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!STREAM_JWT_SECRET_RAW) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'STREAM_JWT_SECRET is not configured',
        });
      }

      // Verify the site belongs to the org
      const site = await ctx.prisma.site.findFirst({
        where: {
          id: input.siteId,
          siteGroup: { project: { orgId: ctx.orgId! } },
        },
      });
      if (!site) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Site not found in this org' });
      }

      const secret = new TextEncoder().encode(STREAM_JWT_SECRET_RAW);
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 300; // 5 minutes

      const token = await new SignJWT({
        siteId: input.siteId,
        userId: ctx.userId,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .sign(secret);

      return {
        token,
        expiresAt: new Date(exp * 1000).toISOString(),
        streamUrl: `${STREAM_SERVICE_URL}/sites/${input.siteId}/stream`,
      };
    }),
  siteGroupToken: orgProcedure
    .input(z.object({ orgId: z.string().cuid(), siteGroupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!STREAM_JWT_SECRET_RAW) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'STREAM_JWT_SECRET is not configured' });
      const sg = await ctx.prisma.siteGroup.findFirst({ where: { id: input.siteGroupId, project: { orgId: ctx.orgId! } }, select: { id: true } });
      if (!sg) throw new TRPCError({ code: 'NOT_FOUND' });
      const secret = new TextEncoder().encode(STREAM_JWT_SECRET_RAW);
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 300;
      const token = await new SignJWT({ kind: 'siteGroupInbound', siteGroupId: input.siteGroupId, userId: ctx.userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(now).setExpirationTime(exp).sign(secret);
      return { token, expiresAt: new Date(exp * 1000).toISOString(), streamUrl: `${SIMULATOR_PUBLIC_URL}/sitegroups/${input.siteGroupId}/inbound` };
    }),
});
