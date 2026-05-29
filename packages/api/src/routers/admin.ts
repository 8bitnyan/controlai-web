import { z } from 'zod';
import { router, ownerAdminProcedure } from '../trpc';
import { callDaemon } from '../lib/daemon-client';

type UnclaimedSiteRow = {
  realUuid: string;
  lastSeenAt: string | null;
  lastSignalPreview: string | null;
};

type DaemonUnclaimedSite = {
  realUuid?: string;
  real_uuid?: string;
  id?: string;
  lastSeenAt?: string | null;
  last_seen_at?: string | null;
  lastSignalPreview?: string | null;
  last_signal_preview?: string | null;
};

async function listUnclaimedBoards(instance: { baseURL: string; bearerTokenEnc: string }): Promise<UnclaimedSiteRow[]> {
  try {
    const rows = await callDaemon<DaemonUnclaimedSite[]>(
      instance,
      '/v1/tenants/factory-qa-unclaimed/sites',
    );

    return (rows ?? [])
      .map((row) => ({
        realUuid: row.realUuid ?? row.real_uuid ?? row.id ?? '',
        lastSeenAt: row.lastSeenAt ?? row.last_seen_at ?? null,
        lastSignalPreview: row.lastSignalPreview ?? row.last_signal_preview ?? null,
      }))
      .filter((row) => row.realUuid.length > 0);
  } catch (error) {
    console.error('[admin.unclaimedBoards.list] daemon unavailable', error);
    return [];
  }
}

export const adminRouter = router({
  unclaimedBoards: router({
    list: ownerAdminProcedure
      .input(z.object({ orgId: z.string().cuid() }))
      .query(async ({ ctx, input }) => {
        const instance = await ctx.prisma.controlaiInstance.findFirst({
          where: { orgId: input.orgId, legacy: false },
          select: { baseURL: true, bearerTokenEnc: true },
          orderBy: { createdAt: 'asc' },
        });

        if (!instance) return [];
        return listUnclaimedBoards(instance);
      }),
  }),
});
